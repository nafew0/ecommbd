import {
    defaultPaymentSettings,
    defaultShippingSettings,
    type PaymentSettings,
    takaToMinor,
} from '@ecommbd/shared';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPaymentRiskCheck } from '../../src/plugins/payments-bd';
import { KUSHTIA, prepareCheckout, TRANSITION } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3058;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;

const tk = takaToMinor;
/** One panjabi (৳1,250) to Mirpur (৳60 delivery). */
const TOTAL = tk(1310);

// Fraud protection's hook (phase 11): phones ending in 999 are blocked from COD, 888 are risky.
registerPaymentRiskCheck({
    codBlocked: async (_ctx, order) => !!order.shippingAddress?.phoneNumber?.endsWith('999'),
    risky: async (_ctx, order) => !!order.shippingAddress?.phoneNumber?.endsWith('888'),
});

const ADD_PAYMENT = gql`
    mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ... on Order {
                id
                code
                state
                totalWithTax
                payments {
                    id
                    method
                    amount
                    state
                    metadata
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PaymentDeclinedError {
                paymentErrorMessage
            }
            ... on IneligiblePaymentMethodError {
                eligibilityCheckerMessage
            }
        }
    }
`;

const OPTIONS = gql`
    query {
        bdPaymentOptions {
            codAvailable
            codUnavailableReason
            codUnavailableMessage
            advanceAmount
            codAmount
            codFee
            mfs {
                provider
                methodCode
                number
                accountType
            }
        }
    }
`;

const ELIGIBLE_PAYMENTS = gql`
    query {
        eligiblePaymentMethods {
            code
            isEligible
        }
    }
`;

const CHOICE = gql`
    mutation ($choice: String!) {
        setBdPaymentChoice(choice: $choice) {
            totalWithTax
            surcharges {
                sku
                priceWithTax
            }
        }
    }
`;

const ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            state
            totalWithTax
            bd {
                status
                paymentType
                paidAmount
                codDue
            }
            payments {
                id
                method
                amount
                state
                metadata
                refunds {
                    total
                    method
                    transactionId
                    state
                }
            }
        }
    }
`;

const QUEUE = gql`
    query {
        bdPaymentsToVerify {
            paymentId
            orderId
            provider
            senderNumber
            transactionId
            lookalikes
            purpose
            amount
            overdue
        }
    }
`;

const VERIFY = gql`
    mutation ($input: BdVerifyPaymentInput!) {
        verifyBdPayment(input: $input) {
            ... on Payment {
                id
                state
                amount
            }
            ... on BdPaymentError {
                reason
                message
            }
        }
    }
`;

const REJECT = gql`
    mutation ($input: BdRejectPaymentInput!) {
        rejectBdPayment(input: $input) {
            ... on Payment {
                id
                state
            }
            ... on BdPaymentError {
                reason
                message
            }
        }
    }
`;

const REFUND = gql`
    mutation ($input: BdRecordRefundInput!) {
        recordBdRefund(input: $input) {
            ... on Refund {
                id
                total
                state
                method
                transactionId
            }
            ... on BdPaymentError {
                reason
                message
            }
        }
    }
`;

const action = (name: string, inputType: string) => gql`
    mutation ($input: ${inputType}!) {
        ${name}(input: $input) {
            ... on Order { id state bd { status paidAmount codDue paymentType } }
            ... on BdOrderActionError { reason message }
        }
    }
`;
const CONFIRM = action('confirmBdOrder', 'BdConfirmOrderInput');
const PACK = action('packBdOrder', 'BdOrderActionInput');
const SHIP = action('markBdOrderShipped', 'BdOrderActionInput');
const DELIVER = action('markBdOrderDelivered', 'BdOrderActionInput');
const CANCEL = action('cancelBdOrder', 'BdCancelOrderInput');

const UPDATE_PAYMENT_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdPaymentSettings(input: $input) {
            settings
            errors {
                path
                code
            }
        }
    }
`;

const UPDATE_SHIPPING_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdShippingSettings(input: $input) {
            errors {
                path
            }
        }
    }
`;

const BKASH = '01812345678';

async function paymentSettings(patch: (settings: PaymentSettings) => Partial<PaymentSettings> = () => ({})) {
    const settings = defaultPaymentSettings();
    const input = {
        ...settings,
        mfs: { ...settings.mfs, bkash: { enabled: true, number: BKASH, accountType: 'personal' as const } },
    };
    const { updateBdPaymentSettings } = await adminClient.query(UPDATE_PAYMENT_SETTINGS, {
        input: { ...input, ...patch(input) },
    });
    expect(updateBdPaymentSettings.errors).toEqual([]);
}

let phoneSuffix = 1000;
/** A new cart ready to pay: one panjabi to Mirpur (or elsewhere), delivery chosen, ArrangingPayment. */
async function readyToPay(place: { districtId?: string; thanaId?: string; phoneEnding?: string } = {}) {
    await shopClient.asAnonymousUser();
    phoneSuffix += 1;
    const phone = place.phoneEnding ? `01711000${place.phoneEnding}` : `0171200${phoneSuffix}`;
    await prepareCheckout(shopClient, { phone, districtId: place.districtId, thanaId: place.thanaId });
}

async function toArrangingPayment() {
    const { transitionOrderToState } = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
    expect(transitionOrderToState.state).toBe('ArrangingPayment');
}

const pay = (method: string, metadata: Record<string, unknown> = {}, languageCode = 'en') =>
    shopClient
        .query(ADD_PAYMENT, { input: { method, metadata } }, { languageCode })
        .then(result => result.addPaymentToOrder);

let trxCounter = 0;
const newTrx = () => `8N7A6D${String(++trxCounter).padStart(4, '0')}`;

async function orderById(id: string) {
    return (await adminClient.query(ORDER, { id })).order;
}

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await paymentSettings();
    await adminClient.query(UPDATE_SHIPPING_SETTINGS, { input: defaultShippingSettings() });
});

describe('cash on delivery', () => {
    it('places a New order, and settles the COD payment when delivered', async () => {
        await readyToPay();
        await toArrangingPayment();
        const placed = await pay('bd-cod');
        expect(placed).toMatchObject({ state: 'PaymentAuthorized', totalWithTax: TOTAL });
        expect(placed.payments).toMatchObject([{ method: 'bd-cod', amount: TOTAL, state: 'Authorized' }]);
        let order = await orderById(placed.id);
        expect(order.bd).toMatchObject({ status: 'new', paymentType: 'cod', paidAmount: 0, codDue: TOTAL });

        for (const mutation of [CONFIRM, PACK, SHIP, DELIVER]) {
            const result = await adminClient.query(mutation, { input: { orderId: placed.id } });
            expect(Object.values(result)[0]).not.toHaveProperty('reason');
        }
        // Settling runs after the delivery is saved.
        await new Promise(resolve => setTimeout(resolve, 300));
        order = await orderById(placed.id);
        expect(order.payments).toMatchObject([{ method: 'bd-cod', amount: TOTAL, state: 'Settled' }]);
        expect(order.bd).toMatchObject({
            status: 'delivered',
            paidAmount: TOTAL,
            codDue: 0,
            paymentType: 'prepaid',
        });
    });

    it('is not offered above the limit, outside its zones, or to a blocked phone (said politely)', async () => {
        await paymentSettings(s => ({ cod: { ...s.cod, maxOrderTotal: tk(1000) } }));
        await readyToPay();
        let { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions).toMatchObject({
            codAvailable: false,
            codUnavailableReason: 'COD_OVER_LIMIT',
        });
        const { eligiblePaymentMethods } = await shopClient.query(ELIGIBLE_PAYMENTS);
        expect(eligiblePaymentMethods.find((m: { code: string }) => m.code === 'bd-cod').isEligible).toBe(
            false,
        );
        await toArrangingPayment();
        const refused = await pay('bd-cod', {}, 'bn');
        expect(refused).toMatchObject({
            errorCode: 'INELIGIBLE_PAYMENT_METHOD_ERROR',
            eligibilityCheckerMessage:
                'এত বড় অর্ডারে ক্যাশ অন ডেলিভারি নেই। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন।',
        });

        await paymentSettings(s => ({ cod: { ...s.cod, zones: ['dhaka_city'] } }));
        await readyToPay({ districtId: KUSHTIA, thanaId: 'BD40500079' });
        ({ bdPaymentOptions } = await shopClient.query(OPTIONS));
        expect(bdPaymentOptions.codUnavailableReason).toBe('COD_NOT_HERE');

        await paymentSettings();
        await readyToPay({ phoneEnding: '999' });
        ({ bdPaymentOptions } = await shopClient.query(OPTIONS));
        // Never "you are blocked".
        expect(bdPaymentOptions).toMatchObject({
            codAvailable: false,
            codUnavailableReason: 'COD_UNAVAILABLE',
        });
    });
});

describe('manual mobile banking', () => {
    it('shows the merchant’s number only when turned on', async () => {
        await readyToPay();
        const { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions.mfs).toEqual([
            { provider: 'bkash', methodCode: 'bd-bkash', number: '+8801812345678', accountType: 'personal' },
        ]);
        const { eligiblePaymentMethods } = await shopClient.query(ELIGIBLE_PAYMENTS);
        const eligible = Object.fromEntries(
            eligiblePaymentMethods.map((m: { code: string; isEligible: boolean }) => [m.code, m.isEligible]),
        );
        expect(eligible).toMatchObject({
            'bd-cod': true,
            'bd-bkash': true,
            'bd-nagad': false,
            'bd-rocket': false,
        });
    });

    it('places the order with a TrxID, waits for staff, and is prepaid once verified', async () => {
        await readyToPay();
        await toArrangingPayment();
        const trx = newTrx();
        const placed = await pay('bd-bkash', {
            senderNumber: '০১৯১২৩৪৫৬৭৮',
            transactionId: ` ${trx.toLowerCase()} `,
        });
        expect(placed.state).toBe('PaymentAuthorized');
        expect(placed.payments[0]).toMatchObject({ method: 'bd-bkash', amount: TOTAL, state: 'Authorized' });
        // The shopper sees only the public part of the metadata.
        expect(placed.payments[0].metadata).toEqual({
            public: { provider: 'bkash', transactionId: trx, verification: 'pending' },
        });
        expect((await orderById(placed.id)).bd).toMatchObject({ paidAmount: 0, codDue: TOTAL });

        const { bdPaymentsToVerify } = await adminClient.query(QUEUE);
        const waiting = bdPaymentsToVerify.find((p: { orderId: string }) => p.orderId === placed.id);
        expect(waiting).toMatchObject({
            provider: 'bkash',
            senderNumber: '+8801912345678',
            transactionId: trx,
            lookalikes: ['8', '0', '1'],
            purpose: 'full',
            amount: TOTAL,
            overdue: false,
        });

        const { verifyBdPayment } = await adminClient.query(VERIFY, {
            input: { paymentId: waiting.paymentId },
        });
        expect(verifyBdPayment).toMatchObject({ state: 'Settled', amount: TOTAL });
        const order = await orderById(placed.id);
        expect(order.state).toBe('PaymentSettled');
        expect(order.bd).toMatchObject({
            status: 'new',
            paymentType: 'prepaid',
            paidAmount: TOTAL,
            codDue: 0,
        });

        const again = await adminClient.query(VERIFY, { input: { paymentId: waiting.paymentId } });
        expect(again.verifyBdPayment.reason).toBe('ALREADY_CHECKED');
        const { bdPaymentsToVerify: after } = await adminClient.query(QUEUE);
        expect(after.some((p: { orderId: string }) => p.orderId === placed.id)).toBe(false);
    });

    it('rejects with a reason; the whole amount is then due on delivery', async () => {
        await readyToPay();
        await toArrangingPayment();
        const placed = await pay('bd-bkash', { senderNumber: '01912345678', transactionId: newTrx() });
        const paymentId = placed.payments[0].id;
        const noNote = await adminClient.query(REJECT, { input: { paymentId, reason: 'other' } });
        expect(noNote.rejectBdPayment.reason).toBe('NOTE_REQUIRED');
        const { rejectBdPayment } = await adminClient.query(REJECT, {
            input: { paymentId, reason: 'notReceived' },
        });
        expect(rejectBdPayment.state).toBe('Declined');
        const order = await orderById(placed.id);
        expect(order.bd).toMatchObject({ status: 'new', paidAmount: 0, codDue: TOTAL });
        expect(order.payments[0].metadata).toMatchObject({
            verification: 'rejected',
            rejectReason: 'notReceived',
        });
    });

    it('records a smaller amount received as partly paid', async () => {
        await readyToPay();
        await toArrangingPayment();
        const placed = await pay('bd-bkash', { senderNumber: '01912345678', transactionId: newTrx() });
        const paymentId = placed.payments[0].id;
        const bad = await adminClient.query(VERIFY, { input: { paymentId, receivedAmount: 100_050 } });
        expect(bad.verifyBdPayment.reason).toBe('INVALID_AMOUNT');
        await adminClient.query(VERIFY, { input: { paymentId, receivedAmount: tk(1000) } });
        const order = await orderById(placed.id);
        expect(order.bd).toMatchObject({ paymentType: 'advance', paidAmount: tk(1000), codDue: tk(310) });
    });

    it('refuses a transaction ID used before, bad IDs and bad sender numbers', async () => {
        const trx = newTrx();
        await readyToPay();
        await toArrangingPayment();
        expect((await pay('bd-bkash', { senderNumber: '01912345678', transactionId: trx })).state).toBe(
            'PaymentAuthorized',
        );

        await readyToPay();
        await toArrangingPayment();
        const reused = await pay('bd-bkash', {
            senderNumber: '01912345678',
            transactionId: trx.toLowerCase(),
        });
        expect(reused.errorCode).toBe('PAYMENT_DECLINED_ERROR');
        expect(reused.paymentErrorMessage).toBe(
            'This transaction ID was already used. Check the ID in your SMS.',
        );
        const short = await pay('bd-bkash', { senderNumber: '01912345678', transactionId: 'ABC12' });
        expect(short.paymentErrorMessage).toMatch(/8 to 12 letters/);
        const landline = await pay('bd-bkash', { senderNumber: '02-9876543', transactionId: newTrx() });
        expect(landline.paymentErrorMessage).toBe('Enter the mobile number you sent the money from.');
        const off = await pay('bd-nagad', { senderNumber: '01912345678', transactionId: newTrx() });
        expect(off.errorCode).toBeDefined();
    });
});

describe('partial advance', () => {
    it('takes the delivery charge by bKash first and the rest by COD', async () => {
        await paymentSettings(s => ({
            advance: { ...s.advance, enabled: true, rule: 'delivery', scope: 'all' },
        }));
        await readyToPay();
        const { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions).toMatchObject({ advanceAmount: tk(60), codAmount: tk(1250) });
        await toArrangingPayment();

        const codFirst = await pay('bd-cod');
        expect(codFirst.paymentErrorMessage).toBe('Please pay the advance by mobile banking first.');

        const advance = await pay('bd-bkash', {
            senderNumber: '01912345678',
            transactionId: newTrx(),
            purpose: 'advance',
        });
        // Vendure keeps the order open until payments cover the total.
        expect(advance.state).toBe('ArrangingPayment');
        expect(advance.payments.find((p: { method: string }) => p.method === 'bd-bkash').amount).toBe(tk(60));

        const placed = await pay('bd-cod');
        expect(placed.state).toBe('PaymentAuthorized');
        // The first COD try (before the advance) stays on the order as Declined.
        const cod = placed.payments.find(
            (p: { method: string; state: string }) => p.method === 'bd-cod' && p.state !== 'Declined',
        );
        expect(cod).toMatchObject({ amount: tk(1250), state: 'Authorized' });

        const bkash = placed.payments.find((p: { method: string }) => p.method === 'bd-bkash');
        await adminClient.query(VERIFY, { input: { paymentId: bkash.id } });
        const order = await orderById(placed.id);
        expect(order.bd).toMatchObject({ paymentType: 'advance', paidAmount: tk(60), codDue: tk(1250) });
    });

    it('asks risky phones only, with the risky scope', async () => {
        await paymentSettings(s => ({
            advance: { ...s.advance, enabled: true, rule: 'percent', percent: 10, scope: 'risky' },
        }));
        await readyToPay();
        expect((await shopClient.query(OPTIONS)).bdPaymentOptions.advanceAmount).toBe(0);
        await readyToPay({ phoneEnding: '888' });
        expect((await shopClient.query(OPTIONS)).bdPaymentOptions.advanceAmount).toBe(tk(131));
    });
});

describe('COD fee', () => {
    it('is its own line, added when the shopper chooses COD', async () => {
        const shipping = defaultShippingSettings();
        await adminClient.query(UPDATE_SHIPPING_SETTINGS, {
            input: { ...shipping, codFee: { ...shipping.codFee, enabled: true, type: 'flat', flat: tk(10) } },
        });
        await readyToPay();
        expect((await shopClient.query(OPTIONS)).bdPaymentOptions).toMatchObject({
            codFee: tk(10),
            codAmount: TOTAL + tk(10),
        });
        await toArrangingPayment();
        // Without choosing first, the COD charge isn't on the order yet.
        expect((await pay('bd-cod')).paymentErrorMessage).toBe(
            'Your order changed. Please choose how to pay again.',
        );

        const { setBdPaymentChoice: cod } = await shopClient.query(CHOICE, { choice: 'cod' });
        expect(cod).toMatchObject({
            totalWithTax: TOTAL + tk(10),
            surcharges: [{ sku: 'BD-COD-FEE', priceWithTax: tk(10) }],
        });
        const { setBdPaymentChoice: prepaid } = await shopClient.query(CHOICE, { choice: 'prepaid' });
        expect(prepaid).toMatchObject({ totalWithTax: TOTAL, surcharges: [] });
        await shopClient.query(CHOICE, { choice: 'cod' });
        const placed = await pay('bd-cod');
        expect(placed).toMatchObject({ state: 'PaymentAuthorized', totalWithTax: TOTAL + tk(10) });
    });
});

describe('refunds', () => {
    it('must be recorded before cancelling an order with money received', async () => {
        await readyToPay();
        await toArrangingPayment();
        const placed = await pay('bd-bkash', { senderNumber: '01912345678', transactionId: newTrx() });
        const paymentId = placed.payments[0].id;
        await adminClient.query(VERIFY, { input: { paymentId } });

        const refused = await adminClient.query(CANCEL, {
            input: { orderId: placed.id, reason: 'customerCancelled' },
        });
        expect(refused.cancelBdOrder.reason).toBe('REFUND_REQUIRED');

        const tooMuch = await adminClient.query(REFUND, {
            input: { paymentId, amount: TOTAL + tk(1), method: 'bkash' },
        });
        expect(tooMuch.recordBdRefund.reason).toBe('REFUND_TOO_LARGE');
        const { recordBdRefund } = await adminClient.query(REFUND, {
            input: {
                paymentId,
                amount: TOTAL,
                method: 'bkash',
                transactionId: 'RF12345678',
                note: 'Customer cancelled',
            },
        });
        expect(recordBdRefund).toMatchObject({
            total: TOTAL,
            state: 'Settled',
            method: 'bkash',
            transactionId: 'RF12345678',
        });

        const cancelled = await adminClient.query(CANCEL, {
            input: { orderId: placed.id, reason: 'customerCancelled' },
        });
        expect(cancelled.cancelBdOrder.bd).toMatchObject({ status: 'cancelled', paidAmount: 0 });
    });
});

describe('settings and permissions', () => {
    it('needs a number to turn a provider on', async () => {
        const settings = defaultPaymentSettings();
        const { updateBdPaymentSettings } = await adminClient.query(UPDATE_PAYMENT_SETTINGS, {
            input: {
                ...settings,
                mfs: { ...settings.mfs, nagad: { enabled: true, number: '', accountType: 'personal' } },
            },
        });
        expect(updateBdPaymentSettings.errors).toEqual([{ path: 'mfs.nagad.number', code: 'required' }]);
    });

    it('lets only VerifyPayment staff check payments', async () => {
        const { roles } = await adminClient.query(gql`
            {
                roles(options: { filter: { code: { eq: "order-staff" } } }) {
                    items {
                        id
                    }
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($input: CreateAdministratorInput!) {
                    createAdministrator(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    firstName: 'Karim',
                    lastName: 'Staff',
                    emailAddress: 'karim.payments@example.com',
                    password: 'staff-password-123',
                    roleIds: [roles.items[0].id],
                },
            },
        );
        const staff = new SimpleGraphQLClient(config, adminUrl);
        await staff.asUserWithCredentials('karim.payments@example.com', 'staff-password-123');
        await expect(staff.query(QUEUE)).rejects.toThrow(/not currently authorized/);
        await expect(staff.query(VERIFY, { input: { paymentId: '1' } })).rejects.toThrow(
            /not currently authorized/,
        );
    });
});

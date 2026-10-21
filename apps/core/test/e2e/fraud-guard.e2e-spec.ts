import { defaultFraudSettings, defaultSmsSettings, type FraudSettings } from '@ecommbd/shared';
import { RequestContextService, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IncompleteCheckoutService } from '../../src/plugins/fraud-guard';
import { LogSmsDriver } from '../../src/plugins/notifications';
import { ADD_ITEM, DHAKA, MIRPUR, payAndPlace, placePhoneOrder, prepareCheckout, SET_CUSTOMER, TRANSITION } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3064;
const driver = new LogSmsDriver();
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT, {}, { smsDriver: driver }));

const SAVE_PROGRESS = gql`
    mutation ($input: BdCheckoutProgressInput!) {
        saveCheckoutProgress(input: $input)
    }
`;
const INCOMPLETE = gql`
    query ($status: String, $search: String) {
        bdIncompleteCheckouts(status: $status, search: $search) {
            totalItems
            items {
                id
                status
                phone
                name
                districtId
                cart {
                    variantId
                    quantity
                    unitPrice
                }
                cartTotal
                source
                orderNumber
                dismissReason
                smsSentAt
            }
        }
    }
`;
const SAVE_FRAUD = gql`
    mutation ($input: JSON!) {
        updateBdFraudSettings(input: $input) {
            errors {
                path
                code
            }
        }
    }
`;
const BLOCK = gql`
    mutation ($input: BdBlockInput!) {
        blockBdContact(input: $input) {
            entry {
                id
                kind
                value
                expiresAt
            }
            error
        }
    }
`;
const UNBLOCK = gql`
    mutation ($id: ID!) {
        unblockBdContact(id: $id, reason: "Customer called, real order") {
            id
        }
    }
`;
const OTP_FIELDS = 'success errorCode message retryAfterSeconds attemptsLeft';
const SEND_OTP = gql`mutation { sendBdOtp { ${OTP_FIELDS} } }`;
const VERIFY_OTP = gql`mutation ($code: String!) { verifyBdOtp(code: $code) { ${OTP_FIELDS} } }`;
const SKIP_OTP = gql`mutation { skipBdOtp { ${OTP_FIELDS} } }`;
const PAY = gql`
    mutation ($method: String!) {
        addPaymentToOrder(input: { method: $method, metadata: {} }) {
            ... on Order {
                id
                state
                payments {
                    method
                    state
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PaymentDeclinedError {
                paymentErrorMessage
            }
        }
    }
`;
const RISK = gql`
    query ($id: ID!) {
        order(id: $id) {
            bdRisk {
                score
                level
                reasons {
                    code
                    count
                }
            }
            bdOtpStatus
        }
    }
`;

let phoneSuffix = 5000;
const newPhone = () => `01716${String(++phoneSuffix).padStart(6, '0')}`;
const e164 = (phone: string) => `+880${phone.slice(1)}`;

async function fraudSettings(patch: (s: FraudSettings) => Partial<FraudSettings> = () => ({})) {
    const settings = defaultFraudSettings();
    const { updateBdFraudSettings } = await adminClient.query(SAVE_FRAUD, { input: { ...settings, ...patch(settings) } });
    expect(updateBdFraudSettings.errors).toEqual([]);
}

async function incompleteFor(phone: string) {
    const { bdIncompleteCheckouts } = await adminClient.query(INCOMPLETE, { search: phone.slice(-8) });
    return bdIncompleteCheckouts.items as Array<Record<string, unknown>>;
}

/** A cart in a fresh shopper session, with the phone typed (saved as checkout progress). */
async function startCheckout(phone: string, extra: Record<string, unknown> = {}) {
    await shopClient.asAnonymousUser();
    await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 2 });
    const { saveCheckoutProgress } = await shopClient.query(SAVE_PROGRESS, {
        input: { phone, name: 'Karim Mia', districtId: DHAKA, thanaId: MIRPUR, ...extra },
    });
    expect(saveCheckoutProgress).toBe(true);
}

/** A COD checkout up to payment, in a fresh session. */
async function readyForCod(phone: string) {
    await shopClient.asAnonymousUser();
    await prepareCheckout(shopClient, { phone });
    const { transitionOrderToState } = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
    return transitionOrderToState as { state?: string; transitionError?: string };
}

const lastCode = (phone: string) => {
    const sent = driver.sent.filter(message => message.to === e164(phone));
    const sms = sent[sent.length - 1];
    return sms?.text.match(/\d{6}/)?.[0];
};

async function waitForCode(phone: string, count: number) {
    for (let i = 0; i < 50 && driver.sent.filter(m => m.to === e164(phone)).length < count; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return lastCode(phone);
}

/** Moves this phone's codes back in time (cooldown passed, or expired). */
async function ageCodes(phone: string, ms: number, field: 'createdAt' | 'expiresAt' = 'createdAt') {
    await server.app
        .get(TransactionalConnection)
        .rawConnection.query(`UPDATE "bd_otp_code" SET "${field}" = "${field}" - $2 * interval '1 millisecond' WHERE "phone" = $1`, [
            e164(phone),
            ms,
        ]);
}

beforeAll(async () => {
    await server.init({ initialData: testInitialData, productsCsvPath: testProductsCsvPath, customerCount: 0 });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const sms = defaultSmsSettings();
    await adminClient.query(
        gql`
            mutation ($input: JSON!) {
                updateBdSmsSettings(input: $input) {
                    errors {
                        path
                    }
                }
            }
        `,
        { input: { ...sms, quietHours: { ...sms.quietHours, enabled: false } } },
    );
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await fraudSettings();
});

describe('incomplete checkouts', () => {
    it('saves the checkout as the shopper types, then marks it recovered when they order', async () => {
        const phone = newPhone();
        await startCheckout(phone, { source: { utm_source: 'facebook', evil: 'x'.repeat(5000) } });
        // Typing more: the same record is updated.
        await shopClient.query(SAVE_PROGRESS, { input: { phone, name: 'Karim Mia Sr' } });
        let [record] = await incompleteFor(phone);
        expect(record).toMatchObject({
            status: 'open',
            phone: e164(phone),
            name: 'Karim Mia Sr',
            districtId: DHAKA,
            cart: [{ variantId: 'T_1', quantity: 2, unitPrice: 125000 }],
            cartTotal: 250000,
            source: { utm_source: 'facebook' },
        });

        await prepareCheckout(shopClient, { phone });
        await payAndPlace(shopClient);
        await new Promise(resolve => setTimeout(resolve, 300));
        [record] = await incompleteFor(phone);
        expect(record).toMatchObject({ status: 'recovered', orderNumber: expect.any(String) });
    });

    it('keeps one record per phone under bursts of saves, and saves nothing for bots or bad phones', async () => {
        const phone = newPhone();
        await shopClient.asAnonymousUser();
        await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
                shopClient.query(SAVE_PROGRESS, { input: { phone, name: `Rahim ${'a'.repeat(i)}` } }),
            ),
        );
        expect(await incompleteFor(phone)).toHaveLength(1);

        const bot = newPhone();
        await shopClient.query(SAVE_PROGRESS, { input: { phone: bot, website: 'http://spam' } });
        await shopClient.query(SAVE_PROGRESS, { input: { phone: '12345' } });
        expect(await incompleteFor(bot)).toEqual([]);
    });

    it('converts to a staff order, and lets staff send the reminder SMS once or dismiss', async () => {
        const phone = newPhone();
        await startCheckout(phone);
        const [record] = await incompleteFor(phone);
        const send = gql`
            mutation ($id: ID!) {
                sendBdIncompleteCheckoutSms(id: $id) {
                    smsSentAt
                }
            }
        `;
        expect((await adminClient.query(send, { id: record!.id })).sendBdIncompleteCheckoutSms.smsSentAt).toBeTruthy();
        await adminClient.query(send, { id: record!.id });
        await new Promise(resolve => setTimeout(resolve, 500));
        const reminders = driver.sent.filter(message => message.to === e164(phone));
        expect(reminders).toHaveLength(1);
        expect(reminders[0]!.text).toMatch(/^Karim Mia, আপনার অর্ডারটি এখনো বাকি আছে/);

        const { createBdManualOrder } = await adminClient.query(
            gql`
                mutation ($input: BdManualOrderInput!) {
                    createBdManualOrder(input: $input) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            {
                input: {
                    customer: { name: 'Karim Mia', phone },
                    address: { districtId: DHAKA, thanaId: MIRPUR, streetLine1: 'House 1, Road 2, Mirpur' },
                    lines: [{ variantId: 'T_1', quantity: 2 }],
                    payment: { type: 'cod' },
                    source: 'phone',
                    sendSms: false,
                },
            },
        );
        expect(createBdManualOrder.id).toBeDefined();
        await new Promise(resolve => setTimeout(resolve, 300));
        expect((await incompleteFor(phone))[0]).toMatchObject({ status: 'converted' });

        const other = newPhone();
        await startCheckout(other);
        const [open] = await incompleteFor(other);
        const { dismissBdIncompleteCheckout } = await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    dismissBdIncompleteCheckout(id: $id, reason: "wrongNumber") {
                        status
                        dismissReason
                    }
                }
            `,
            { id: open!.id },
        );
        expect(dismissBdIncompleteCheckout).toEqual({ status: 'dismissed', dismissReason: 'wrongNumber' });
    });

    it('deletes the personal data after 30 days and keeps the count', async () => {
        const phone = newPhone();
        await startCheckout(phone);
        const [record] = await incompleteFor(phone);
        const connection = server.app.get(TransactionalConnection);
        await connection.rawConnection.query(
            `UPDATE "bd_incomplete_checkout" SET "createdAt" = $2 WHERE "phone" = $1`,
            [e164(phone), new Date(Date.now() - 31 * 24 * 60 * 60_000)],
        );
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        expect(await server.app.get(IncompleteCheckoutService).expire(ctx)).toBeGreaterThanOrEqual(1);
        expect(await incompleteFor(phone)).toEqual([]);
        const [row] = await connection.rawConnection.query(
            `SELECT "status", "phone", "name", "cart" FROM "bd_incomplete_checkout" WHERE "id" = $1`,
            [String(record!.id).replace('T_', '')],
        );
        expect(row).toEqual({ status: 'expired', phone: null, name: null, cart: null });
        const { bdIncompleteCheckoutCounts } = await adminClient.query(gql`
            {
                bdIncompleteCheckoutCounts {
                    expired
                }
            }
        `);
        expect(bdIncompleteCheckoutCounts.expired).toBeGreaterThanOrEqual(1);
    });
});

describe('block list and velocity', () => {
    it('refuses a blocked phone politely, and lets it order again once unblocked', async () => {
        const phone = newPhone();
        const { blockBdContact } = await adminClient.query(BLOCK, {
            input: { kind: 'phone', value: phone, note: 'Two fake orders' },
        });
        expect(blockBdContact.entry).toMatchObject({ kind: 'phone', value: e164(phone), expiresAt: null });

        await shopClient.asAnonymousUser();
        await prepareCheckout(shopClient, { phone });
        const refused = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' }, { languageCode: 'en' });
        expect(refused.transitionOrderToState.transitionError).toBe(
            'Sorry, we can’t take this order online. Please call or message us to order.',
        );
        expect(refused.transitionOrderToState.transitionError).not.toMatch(/block/i);

        await adminClient.query(UNBLOCK, { id: blockBdContact.entry.id });
        const allowed = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
        expect(allowed.transitionOrderToState.state).toBe('ArrangingPayment');
    });

    it('blocks IPs only for a while, and refuses orders from a blocked IP', async () => {
        const block = (value: string, expiresAt?: Date) =>
            adminClient.query(BLOCK, { input: { kind: 'ip', value, expiresAt } }).then(r => r.blockBdContact);
        expect((await block('203.0.113.9')).error).toBe('EXPIRY_REQUIRED');
        expect((await block('203.0.113.9', new Date(Date.now() + 40 * 86_400_000))).error).toBe('EXPIRY_TOO_LONG');
        expect((await block('not-an-ip', new Date(Date.now() + 3_600_000))).error).toBe('INVALID_IP');
        // Tests reach the server from localhost (IPv4 or IPv6).
        const entries = [
            await block('::ffff:127.0.0.1', new Date(Date.now() + 3_600_000)),
            await block('::1', new Date(Date.now() + 3_600_000)),
        ];
        try {
            expect(entries[0].entry.value).toBe('127.0.0.1');
            const refused = await readyForCod(newPhone());
            expect(refused.transitionError).toMatch(/can’t take this order online/);
        } finally {
            for (const { entry } of entries) await adminClient.query(UNBLOCK, { id: entry.id });
        }
        expect((await readyForCod(newPhone())).state).toBe('ArrangingPayment');
    });

    it('limits orders per phone a day, and shows the merchant’s message within the duplicate window', async () => {
        await fraudSettings(s => ({ velocity: { ...s.velocity, maxOrdersPerPhonePerDay: 2 } }));
        const phone = newPhone();
        await placePhoneOrder(shopClient, { phone });
        await placePhoneOrder(shopClient, { phone });
        expect((await readyForCod(phone)).transitionError).toMatch(/You have placed several orders today/);

        await fraudSettings(s => ({ velocity: { ...s.velocity, duplicateOrderMinutes: 30 } }));
        const other = newPhone();
        await placePhoneOrder(shopClient, { phone: other });
        // The merchant's message in the store's language (Bangla here; the storefront asks for its own).
        expect((await readyForCod(other)).transitionError).toBe(defaultFraudSettings().velocity.duplicateOrderMessage.bn);
        // Staff can still take an order for that phone.
    });

    it('refuses bot-looking checkouts with a vague message', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        for (const extra of [{ website: 'spam' }, { secondsOnForm: 1 }]) {
            const { setCustomerForOrderByPhone } = await shopClient.query(SET_CUSTOMER, {
                input: { name: 'Rahim', phone: newPhone(), ...extra },
            });
            expect(setCustomerForOrderByPhone.reason).toBe('TRY_AGAIN');
        }
        const { setCustomerForOrderByPhone } = await shopClient.query(SET_CUSTOMER, {
            input: { name: 'Rahim', phone: newPhone(), secondsOnForm: 40 },
        });
        expect(setCustomerForOrderByPhone.reason).toBeUndefined();
    });
});

describe('risk score', () => {
    it('shows "fake before" on the next order, only to staff with ReadRisk', async () => {
        const phone = newPhone();
        const first = await placePhoneOrder(shopClient, { phone });
        await adminClient.query(
            gql`
                mutation ($input: BdCancelOrderInput!) {
                    cancelBdOrder(input: $input) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            { input: { orderId: first.id, reason: 'fake' } },
        );
        const second = await placePhoneOrder(shopClient, { phone, name: 'asdfgh' });
        await new Promise(resolve => setTimeout(resolve, 300));
        const { order } = await adminClient.query(RISK, { id: second.id });
        // The fake order also counts as a recent order from this phone.
        expect(order.bdRisk).toEqual({
            score: 65,
            level: 'high',
            reasons: [
                { code: 'fakeBefore', count: 1 },
                { code: 'manyOrders', count: 2 },
                { code: 'oddName', count: null },
            ],
        });

        // A role with orders but without ReadRisk sees no badge.
        const { createRole } = await adminClient.query(gql`
            mutation {
                createRole(input: { code: "no-risk", description: "No risk", permissions: [ReadOrder] }) {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($roleId: ID!) {
                    createAdministrator(
                        input: {
                            firstName: "Shila"
                            lastName: "Staff"
                            emailAddress: "shila@example.com"
                            password: "shila-password"
                            roleIds: [$roleId]
                        }
                    ) {
                        id
                    }
                }
            `,
            { roleId: createRole.id },
        );
        await adminClient.asUserWithCredentials('shila@example.com', 'shila-password');
        expect((await adminClient.query(RISK, { id: second.id })).order.bdRisk).toBeNull();
    });
});

describe('verification code for COD', () => {
    it('asks for a code, refuses COD without it, and accepts the right code', async () => {
        await fraudSettings(s => ({ otp: { ...s.otp, mode: 'all' } }));
        const phone = newPhone();
        expect((await readyForCod(phone)).state).toBe('ArrangingPayment');
        const { bdPaymentOptions } = await shopClient.query(gql`
            {
                bdPaymentOptions {
                    codOtpRequired
                }
            }
        `);
        expect(bdPaymentOptions.codOtpRequired).toBe(true);
        const refused = (await shopClient.query(PAY, { method: 'bd-cod' }, { languageCode: 'en' })).addPaymentToOrder;
        expect(refused.paymentErrorMessage).toBe('Enter the code we sent to your phone by SMS to confirm the order.');

        expect((await shopClient.query(SEND_OTP)).sendBdOtp).toMatchObject({ success: true, retryAfterSeconds: 60 });
        const code = await waitForCode(phone, 1);
        expect(code).toMatch(/^\d{6}$/);
        expect((await shopClient.query(SEND_OTP)).sendBdOtp).toMatchObject({ success: false, errorCode: 'COOLDOWN' });

        const wrong = code === '000000' ? '111111' : '000000';
        expect((await shopClient.query(VERIFY_OTP, { code: wrong })).verifyBdOtp).toMatchObject({
            success: false,
            errorCode: 'WRONG_CODE',
            attemptsLeft: 2,
        });
        expect((await shopClient.query(VERIFY_OTP, { code })).verifyBdOtp.success).toBe(true);
        const placed = (await shopClient.query(PAY, { method: 'bd-cod' })).addPaymentToOrder;
        // Vendure keeps the refused attempt as a declined payment.
        expect(placed.payments).toMatchObject([
            { method: 'bd-cod', state: 'Declined' },
            { method: 'bd-cod', state: 'Authorized' },
        ]);
        expect((await adminClient.query(RISK, { id: placed.id })).order.bdOtpStatus).toBe('verified');

        // The code isn't kept in the SMS list once sent.
        const [row] = await server.app
            .get(TransactionalConnection)
            .rawConnection.query(`SELECT "body" FROM "bd_sms_message" WHERE "event" = 'otp' AND "to" = $1`, [e164(phone)]);
        expect(row.body).not.toContain(code);
        expect(row.body).toContain('••••••');
    });

    it('stops after 3 wrong tries, expires codes, and allows 5 codes a phone a day', async () => {
        await fraudSettings(s => ({ otp: { ...s.otp, mode: 'all' } }));
        const phone = newPhone();
        await readyForCod(phone);
        await shopClient.query(SEND_OTP);
        const code = await waitForCode(phone, 1);
        const wrong = code === '000000' ? '111111' : '000000';
        await shopClient.query(VERIFY_OTP, { code: wrong });
        await shopClient.query(VERIFY_OTP, { code: wrong });
        expect((await shopClient.query(VERIFY_OTP, { code: wrong })).verifyBdOtp.errorCode).toBe('TOO_MANY_ATTEMPTS');
        expect((await shopClient.query(VERIFY_OTP, { code })).verifyBdOtp.errorCode).toBe('TOO_MANY_ATTEMPTS');

        await ageCodes(phone, 61_000);
        await shopClient.query(SEND_OTP);
        await ageCodes(phone, 6 * 60_000, 'expiresAt');
        expect((await shopClient.query(VERIFY_OTP, { code: '123456' })).verifyBdOtp.errorCode).toBe('EXPIRED');

        for (let sent = 2; sent < 5; sent += 1) {
            await ageCodes(phone, 61_000);
            expect((await shopClient.query(SEND_OTP)).sendBdOtp.success).toBe(true);
        }
        await ageCodes(phone, 61_000);
        expect((await shopClient.query(SEND_OTP)).sendBdOtp).toMatchObject({ success: false, errorCode: 'DAILY_LIMIT' });
    });

    it('asks first-time phones only, when set so', async () => {
        await fraudSettings(s => ({ otp: { ...s.otp, mode: 'firstTime' } }));
        const phone = newPhone();
        await readyForCod(phone);
        expect((await shopClient.query(PAY, { method: 'bd-cod' })).addPaymentToOrder.paymentErrorMessage).toBeTruthy();
        await fraudSettings();
        await placePhoneOrder(shopClient, { phone });
        await fraudSettings(s => ({ otp: { ...s.otp, mode: 'firstTime' } }));
        await readyForCod(phone);
        expect((await shopClient.query(PAY, { method: 'bd-cod' })).addPaymentToOrder.state).toBe('PaymentAuthorized');
    });

    it('lets a shopper with no SMS order unverified, if the store allows it', async () => {
        await fraudSettings(() => ({ otp: { mode: 'all', allowUnverified: false } }));
        const phone = newPhone();
        await readyForCod(phone);
        expect((await shopClient.query(SKIP_OTP)).skipBdOtp.errorCode).toBe('NOT_ALLOWED');
        await fraudSettings(() => ({ otp: { mode: 'all', allowUnverified: true } }));
        expect((await shopClient.query(SKIP_OTP)).skipBdOtp.errorCode).toBe('NO_CODE');
        await shopClient.query(SEND_OTP);
        expect((await shopClient.query(SKIP_OTP)).skipBdOtp.errorCode).toBe('COOLDOWN');
        await ageCodes(phone, 61_000);
        expect((await shopClient.query(SKIP_OTP)).skipBdOtp.success).toBe(true);
        const placed = (await shopClient.query(PAY, { method: 'bd-cod' })).addPaymentToOrder;
        expect(placed.state).toBe('PaymentAuthorized');
        expect((await adminClient.query(RISK, { id: placed.id })).order.bdOtpStatus).toBe('unverified');
    });
});

import { defaultOnlinePaymentSettings, defaultPaymentSettings, takaToMinor } from '@ecommbd/shared';
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BkashTokenService, OnlinePaymentService } from '../../src/plugins/payments-online';
import { prepareCheckout, TRANSITION } from '../support/checkout';
import { BKASH_CREDENTIALS, MockGateways, SSL_CREDENTIALS } from '../support/mock-gateways';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3071;
// Each gateway on its own host, as in production: one's circuit breaker never hides the other.
const mock = new MockGateways(4071);
const bk = new MockGateways(4072);
const config = createTestConfig(
    PORT,
    {},
    {
        gatewayBaseUrls: { sslcommerz: mock.url, bkash: `${bk.url}/bkash` },
    },
);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const core = `http://localhost:${PORT}`;

const tk = takaToMinor;
/** One panjabi (৳1,250) to Mirpur (৳60 delivery). */
const TOTAL = tk(1310);

const ADD_PAYMENT = gql`
    mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ... on Order {
                id
                code
                state
                customFields {
                    orderNumber
                }
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
            advanceAmount
            codAmount
            online {
                gateway
                methodCode
                mode
            }
        }
    }
`;

const CHOICE = gql`
    mutation ($choice: String!) {
        setBdPaymentChoice(choice: $choice) {
            totalWithTax
        }
    }
`;

const ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            state
            totalWithTax
            customFields {
                orderNumber
                trackingToken
            }
            bd {
                status
                paidAmount
                codDue
                paymentType
            }
            payments {
                id
                method
                amount
                state
            }
        }
    }
`;

const SETUP = gql`
    query {
        bdOnlinePaymentSetup {
            settings
            keyringConfigured
            publicUrlConfigured
            ipnUrl
            credentials {
                gateway
                mode
                complete
                fields {
                    name
                    saved
                    value
                }
            }
        }
    }
`;

const UPDATE_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdOnlinePaymentSettings(input: $input) {
            errors {
                path
                code
            }
        }
    }
`;

const SAVE_CREDENTIALS = gql`
    mutation ($gateway: String!, $mode: String!, $input: JSON!) {
        saveBdGatewayCredentials(gateway: $gateway, mode: $mode, input: $input) {
            credentials {
                complete
            }
            errors {
                path
                code
            }
        }
    }
`;

const TEST_CONNECTION = gql`
    mutation ($gateway: String!, $mode: String!) {
        testBdGatewayConnection(gateway: $gateway, mode: $mode) {
            ok
            reason
            message
        }
    }
`;

const ATTEMPTS = gql`
    query ($orderId: ID!) {
        bdPaymentAttempts(orderId: $orderId) {
            id
            status
            amount
            paidAmount
            gatewayTransactionId
            payerAccount
            failureCode
            reviewReason
            reviewState
            riskTitle
            refundReference
            events {
                source
                status
            }
        }
    }
`;

const REVIEWS = gql`
    query {
        bdPaymentReviews {
            id
            reviewReason
            orderId
        }
    }
`;

const REVIEW = gql`
    mutation ($id: ID!, $action: String!, $note: String) {
        reviewBdPayment(id: $id, action: $action, note: $note) {
            ... on BdPaymentAttempt {
                id
                reviewState
                refundReference
            }
            ... on BdOnlinePaymentError {
                reason
                message
                detail
            }
        }
    }
`;

/** Staff cancel an order (the merchant admin's "Cancel order"). */
const CANCEL = gql`
    mutation ($id: ID!) {
        cancelBdOrder(input: { orderId: $id, reason: "customerCancelled" }) {
            ... on Order {
                state
            }
            ... on BdOrderActionError {
                reason
            }
        }
    }
`;

const SMS = gql`
    query ($orderId: ID!) {
        bdSmsMessages(orderId: $orderId) {
            event
        }
    }
`;

const TRACK = gql`
    query ($token: String!) {
        bdTrackOrderByToken(token: $token) {
            status
            timeline {
                status
            }
            onlinePayment {
                gateway
                purpose
                amount
                lastFailure
                lastFailureMessage
            }
        }
    }
`;

const LOOK_UP = gql`
    query ($id: ID!) {
        bdLookupBkashTransaction(attemptId: $id) {
            ... on BdBkashTransaction {
                status
                amount
                payerAccount
            }
            ... on BdOnlinePaymentError {
                reason
            }
        }
    }
`;

const UPDATE_PAYMENT_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdPaymentSettings(input: $input) {
            errors {
                path
            }
        }
    }
`;

const db = () => server.app.get(TransactionalConnection).rawConnection;
/** A database ID from the test API's "T_4". */
const n = (id: string) => Number(String(id).replace(/^T_/, ''));
const queuedAt = async (id: string) =>
    (await db().query(`SELECT "customFieldsConfirmqueueat" AS at FROM "order" WHERE id = $1`, [n(id)]))[0].at;
const service = () => server.app.get(OnlinePaymentService);

async function onlineSettings(patch: Record<string, unknown> = {}) {
    const settings = defaultOnlinePaymentSettings();
    const { updateBdOnlinePaymentSettings } = await adminClient.query(UPDATE_SETTINGS, {
        input: {
            ...settings,
            sslcommerz: { enabled: true, mode: 'sandbox' },
            bkash: { enabled: true, mode: 'sandbox' },
            ...patch,
        },
    });
    expect(updateBdOnlinePaymentSettings.errors).toEqual([]);
}

let phoneSuffix = 3000;
/** A new cart for one panjabi (or more) to Mirpur, at ArrangingPayment, with the given payment choice. */
async function readyToPay(choice: 'prepaid' | 'cod' = 'prepaid', quantity = 1) {
    await shopClient.asAnonymousUser();
    phoneSuffix += 1;
    await prepareCheckout(shopClient, { phone: `0171300${phoneSuffix}`, quantity });
    await shopClient.query(CHOICE, { choice });
    const { transitionOrderToState } = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
    expect(transitionOrderToState.state).toBe('ArrangingPayment');
}

const pay = (method: string, metadata: Record<string, unknown>) =>
    shopClient.query(ADD_PAYMENT, { input: { method, metadata } }).then(result => result.addPaymentToOrder);

const orderById = async (id: string) => (await adminClient.query(ORDER, { id })).order;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The order's tracking token, given just after placement (an event subscriber). */
async function trackingToken(id: string): Promise<string> {
    for (let tries = 0; tries < 50; tries++) {
        const token = (await orderById(id)).customFields.trackingToken;
        if (token) return token;
        await wait(50);
    }
    throw new Error(`Order ${id} has no tracking token`);
}
const attemptsOf = async (orderId: string) =>
    (await adminClient.query(ATTEMPTS, { orderId })).bdPaymentAttempts;

/** The core's own address for a public link (the store's address is shop.example.com in tests). */
const local = (url: string) => url.replace('https://shop.example.com', core);

/** "Pay now" on the tracking page: our pay page, then the gateway's (as the browser would go). */
async function payAgain(orderId: string): Promise<string> {
    const payPage = await follow(`${core}/bd-pay/again/${await trackingToken(orderId)}`, { method: 'POST' });
    const token = new URL(payPage).searchParams.get('to');
    expect(payPage).toMatch(/^https:\/\/shop\.example\.com\/checkout\/pay\/\?to=[a-f0-9]{30}$/);
    return follow(`${core}/bd-pay/start/${token}`);
}

/** The order's attempts still being asked about are due for the reconciliation task now. */
const dueNow = (orderId: string) =>
    db().query(
        `UPDATE bd_payment_attempt SET "nextCheckAt" = now() - interval '1 minute' WHERE "orderId" = $1 AND "nextCheckAt" IS NOT NULL`,
        [n(orderId)],
    );
/** The order's newest attempt as stored (fields the API doesn't show). */
const attemptRow = async (orderId: string) =>
    (
        await db().query(
            `SELECT status, "nextCheckAt", "reviewState" FROM bd_payment_attempt WHERE "orderId" = $1 ORDER BY id DESC LIMIT 1`,
            [n(orderId)],
        )
    )[0];

/** Follows our redirect once; returns the Location header. */
async function follow(url: string, init: RequestInit = {}): Promise<string> {
    const response = await fetch(local(url), { redirect: 'manual', ...init });
    expect(response.status).toBe(303);
    return response.headers.get('location')!;
}

const postForm = (path: string, fields: Record<string, string>) =>
    fetch(`${core}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
    });

/** Places an SSLCommerz order and opens the gateway page. Returns the order and our tran_id. */
async function placeSsl() {
    await readyToPay();
    const placed = await pay('bd-sslcommerz', { purpose: 'full' });
    const { payUrl } = placed.payments[0].metadata.public;
    const gatewayPage = await follow(payUrl);
    const tranId = gatewayPage.split('/pay/')[1]!;
    return { placed, payUrl, tranId };
}

beforeAll(async () => {
    await mock.start();
    await bk.start();
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    for (const mode of ['sandbox', 'live']) {
        await adminClient.query(SAVE_CREDENTIALS, { gateway: 'sslcommerz', mode, input: SSL_CREDENTIALS });
        await adminClient.query(SAVE_CREDENTIALS, { gateway: 'bkash', mode, input: BKASH_CREDENTIALS });
    }
}, 120_000);

afterAll(async () => {
    await server.destroy();
    await mock.stop();
    await bk.stop();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await onlineSettings();
    await adminClient.query(UPDATE_PAYMENT_SETTINGS, { input: defaultPaymentSettings() });
    mock.sslSessionStatus = 200;
    mock.sslRefundAnswer = 'success';
    mock.sslValidationInvalid = false;
    mock.sslOmitTranId = false;
    bk.bkashReset();
    await server.app.get(BkashTokenService).clear();
});

describe('setup', () => {
    it('keeps credentials encrypted and write-only, and tests the connection', async () => {
        const { bdOnlinePaymentSetup } = await adminClient.query(SETUP);
        expect(bdOnlinePaymentSetup).toMatchObject({ keyringConfigured: true, publicUrlConfigured: true });
        expect(bdOnlinePaymentSetup.ipnUrl).toBe('https://shop.example.com/bd-pay/sslcommerz/ipn');
        const ssl = bdOnlinePaymentSetup.credentials.find(
            (item: { gateway: string; mode: string }) =>
                item.gateway === 'sslcommerz' && item.mode === 'sandbox',
        );
        expect(ssl.fields).toEqual([
            { name: 'storeId', saved: true, value: 'teststore' },
            { name: 'storePassword', saved: true, value: null },
        ]);
        // Stored encrypted: the password isn't in the database as text.
        const rows = await db().query(
            `SELECT value::text FROM settings_store_entry WHERE key = 'paymentsOnline.credentials'`,
        );
        expect(JSON.stringify(rows)).not.toContain('testpass');

        expect(
            (await adminClient.query(TEST_CONNECTION, { gateway: 'sslcommerz', mode: 'sandbox' }))
                .testBdGatewayConnection,
        ).toEqual({
            ok: true,
            reason: null,
            message: null,
        });
        expect(
            (await adminClient.query(TEST_CONNECTION, { gateway: 'bkash', mode: 'sandbox' }))
                .testBdGatewayConnection.ok,
        ).toBe(true);
        // A blank field keeps what's saved; a wrong password fails the test.
        await adminClient.query(SAVE_CREDENTIALS, {
            gateway: 'sslcommerz',
            mode: 'live',
            input: { storePassword: 'wrong' },
        });
        const failed = (await adminClient.query(TEST_CONNECTION, { gateway: 'sslcommerz', mode: 'live' }))
            .testBdGatewayConnection;
        // A code the admin translates, with SSLCommerz's own word after it.
        expect(failed).toEqual({ ok: false, reason: 'refused', message: 'INVALID_REQUEST' });
        await adminClient.query(SAVE_CREDENTIALS, {
            gateway: 'sslcommerz',
            mode: 'live',
            input: SSL_CREDENTIALS,
        });
    });

    it('offers only gateways that are on and set up', async () => {
        await readyToPay();
        let { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions.online.map((option: { gateway: string }) => option.gateway)).toEqual([
            'sslcommerz',
            'bkash',
        ]);
        await onlineSettings({ bkash: { enabled: false, mode: 'sandbox' } });
        ({ bdPaymentOptions } = await shopClient.query(OPTIONS));
        expect(bdPaymentOptions.online).toEqual([
            { gateway: 'sslcommerz', methodCode: 'bd-sslcommerz', mode: 'sandbox' },
        ]);
        const refused = await pay('bd-bkash-online', { purpose: 'full' });
        expect(refused.errorCode).toBe('INELIGIBLE_PAYMENT_METHOD_ERROR');
    });
});

describe('SSLCommerz', () => {
    it('places the order unpaid, outside the confirmation queue, and settles it from the IPN', async () => {
        const { placed, tranId } = await placeSsl();
        expect(placed.state).toBe('AwaitingPayment');
        expect(placed.customFields.orderNumber).toMatch(/^\d+$/);
        expect(placed.payments).toMatchObject([{ method: 'bd-sslcommerz', amount: TOTAL, state: 'Pending' }]);
        let order = await orderById(placed.id);
        // Nothing to collect on delivery: it's paid online.
        expect(order.bd).toMatchObject({
            status: 'awaitingPayment',
            paidAmount: 0,
            codDue: 0,
            paymentType: 'prepaid',
        });
        expect(await queuedAt(placed.id)).toBeNull();
        // The "order placed" SMS waits for the payment.
        await wait(300);
        expect((await adminClient.query(SMS, { orderId: placed.id })).bdSmsMessages).toEqual([]);

        const ipn = mock.sslPay(tranId);
        const response = await postForm('/bd-pay/sslcommerz/ipn', ipn);
        expect(response.status).toBe(200);
        order = await orderById(placed.id);
        expect(order).toMatchObject({ state: 'PaymentSettled', bd: { status: 'new', paidAmount: TOTAL } });
        expect(await queuedAt(placed.id)).not.toBeNull();
        expect(order.payments).toMatchObject([{ state: 'Settled', amount: TOTAL }]);
        await wait(300);
        expect(
            (await adminClient.query(SMS, { orderId: placed.id })).bdSmsMessages.map(
                (m: { event: string }) => m.event,
            ),
        ).toEqual(['placed']);

        // A duplicate IPN and the shopper's return change nothing, and the shopper sees "paid".
        await postForm('/bd-pay/sslcommerz/ipn', ipn);
        const back = await postForm(`/bd-pay/sslcommerz/return/${tranId}/success`, ipn);
        expect(back.status).toBe(303);
        expect(back.headers.get('location')).toMatch(
            /^https:\/\/shop\.example\.com\/t\/[\w-]+\/\?payment=paid$/,
        );
        const attempts = await attemptsOf(placed.id);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({ status: 'paid', paidAmount: TOTAL, reviewState: null });
        expect((await orderById(placed.id)).payments).toHaveLength(1);
    });

    it('ignores a tampered return: only the gateway can say it was paid', async () => {
        const { placed, tranId } = await placeSsl();
        // A forged "VALID" with a made-up val_id and no valid signature.
        const back = await postForm(`/bd-pay/sslcommerz/return/${tranId}/success`, {
            status: 'VALID',
            tran_id: tranId,
            val_id: 'FORGED123',
            amount: '1.00',
            verify_sign: 'deadbeef',
            verify_key: 'status,tran_id,val_id,amount',
        });
        expect(back.headers.get('location')).toContain('payment=pending');
        expect((await orderById(placed.id)).state).toBe('AwaitingPayment');
        // An IPN for a transaction we never made is ignored.
        expect(
            (
                await postForm('/bd-pay/sslcommerz/ipn', {
                    status: 'VALID',
                    tran_id: 'f'.repeat(32),
                    val_id: 'X',
                })
            ).status,
        ).toBe(200);
    });

    it('finds a payment whose IPN never arrived (reconciliation)', async () => {
        const { placed, tranId } = await placeSsl();
        mock.sslPay(tranId); // paid, but no notification
        await db().query(
            `UPDATE bd_payment_attempt SET "nextCheckAt" = now() - interval '1 minute' WHERE "orderId" = $1`,
            [n(placed.id)],
        );
        expect(await service().reconcile()).toBeGreaterThanOrEqual(1);
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
    });

    it('holds a wrong amount, and a risky payment until staff accept it', async () => {
        const wrong = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(wrong.tranId, { amount: '10.00' }));
        expect((await orderById(wrong.placed.id)).state).toBe('AwaitingPayment');
        expect((await attemptsOf(wrong.placed.id))[0]).toMatchObject({
            reviewReason: 'mismatch',
            reviewState: 'open',
        });

        const risky = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(risky.tranId, { risk: '1' }));
        expect((await orderById(risky.placed.id)).state).toBe('AwaitingPayment');
        const [attempt] = await attemptsOf(risky.placed.id);
        expect(attempt).toMatchObject({ reviewReason: 'risky', riskTitle: 'Risky' });
        // Held for review: the order doesn't expire.
        await db().query(`UPDATE "order" SET "orderPlacedAt" = now() - interval '2 hours' WHERE id = $1`, [
            n(risky.placed.id),
        ]);
        await service().expire();
        expect((await orderById(risky.placed.id)).state).toBe('AwaitingPayment');

        const reviews = (await adminClient.query(REVIEWS)).bdPaymentReviews;
        expect(reviews.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([attempt.id]));
        // Only a risky payment can be accepted; accepting pays the order.
        const [mismatch] = await attemptsOf(wrong.placed.id);
        expect(
            (await adminClient.query(REVIEW, { id: mismatch.id, action: 'accept' })).reviewBdPayment.reason,
        ).toBe('NOT_RISKY');
        const accepted = (await adminClient.query(REVIEW, { id: attempt.id, action: 'accept' }))
            .reviewBdPayment;
        expect(accepted.reviewState).toBe('accepted');
        expect((await orderById(risky.placed.id)).state).toBe('PaymentSettled');
        // Refunding the wrong amount goes back through the gateway.
        const refunded = (await adminClient.query(REVIEW, { id: mismatch.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunded).toMatchObject({
            reviewState: 'refunded',
            refundReference: expect.stringMatching(/^REF/),
        });
        expect(mock.refunds[mock.refunds.length - 1]).toMatchObject({
            gateway: 'sslcommerz',
            amount: '10.00',
        });
    });

    it('expires an unpaid order (stock back), then holds a late payment for a refund', async () => {
        const { placed, tranId } = await placeSsl();
        const stock = async () =>
            (await db().query(`SELECT "stockAllocated" FROM stock_level WHERE "productVariantId" = 1`))[0]
                .stockAllocated;
        const allocated = await stock();
        await db().query(`UPDATE "order" SET "orderPlacedAt" = now() - interval '50 minutes' WHERE id = $1`, [
            n(placed.id),
        ]);
        expect(await service().expire()).toBe(1);
        const order = await orderById(placed.id);
        expect(order).toMatchObject({ state: 'Cancelled', payments: [{ state: 'Cancelled' }] });
        expect(await stock()).toBe(allocated - 1);
        // "Pay now" on a cancelled order says it expired.
        const again = await fetch(`${core}/bd-pay/again/${await trackingToken(placed.id)}`, {
            method: 'POST',
            redirect: 'manual',
        });
        expect(again.headers.get('location')).toContain('payment=expired');

        // The shopper paid anyway, after the window: never dropped, held for staff.
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(tranId));
        const [attempt] = await attemptsOf(placed.id);
        expect(attempt).toMatchObject({ status: 'paid', reviewReason: 'late', reviewState: 'open' });
        expect((await orderById(placed.id)).state).toBe('Cancelled');
        const resolveWithoutNote = (await adminClient.query(REVIEW, { id: attempt.id, action: 'resolve' }))
            .reviewBdPayment;
        expect(resolveWithoutNote.reason).toBe('NOTE_REQUIRED');
        expect(
            (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' })).reviewBdPayment
                .reviewState,
        ).toBe('refunded');
    });

    it('applies one of two payments made in two tabs and holds the other for a refund', async () => {
        const first = await placeSsl();
        // A second try ("Pay now" again) while the first is still open.
        const secondPage = await payAgain(first.placed.id);
        const secondTran = secondPage.split('/pay/')[1]!;
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(first.tranId));
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(secondTran));
        expect((await orderById(first.placed.id)).payments).toMatchObject([
            { state: 'Settled', amount: TOTAL },
        ]);
        const attempts = await attemptsOf(first.placed.id);
        expect(attempts.map((a: { reviewReason: string | null }) => a.reviewReason)).toEqual([
            null,
            'duplicate',
        ]);
    });

    it('sends a tran_id of at most 30 characters and always a postcode', async () => {
        const { tranId } = await placeSsl();
        expect(tranId).toMatch(/^[a-f0-9]{30}$/);
        const form = mock.sslSessionForms[mock.sslSessionForms.length - 1]!;
        expect(form.get('tran_id')).toBe(tranId);
        // Checkout doesn't ask for a postcode: Dhaka GPO's.
        expect(form.get('cus_postcode')).toBe('1000');
        expect((form.get('cus_email') ?? '').length).toBeLessThanOrEqual(50);
    });

    it('still finds a payment when validation says INVALID_TRANSACTION', async () => {
        const { placed, tranId } = await placeSsl();
        mock.sslValidationInvalid = true;
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(tranId));
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
        const [attempt] = await attemptsOf(placed.id);
        expect(attempt.status).toBe('paid');
        expect(attempt.events).toEqual(
            expect.arrayContaining([
                { source: 'validate', status: 'INVALID_TRANSACTION' },
                { source: 'query', status: 'VALIDATED' },
            ]),
        );
    });

    it('never applies an answer without our tran_id, and keeps reconciling', async () => {
        const { placed, tranId } = await placeSsl();
        mock.sslOmitTranId = true;
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(tranId));
        expect((await orderById(placed.id)).state).toBe('AwaitingPayment');
        expect((await attemptsOf(placed.id))[0].status).toBe('started');
        // The gateway's next answer names it: reconciliation applies it.
        mock.sslOmitTranId = false;
        await db().query(
            `UPDATE bd_payment_attempt SET "nextCheckAt" = now() - interval '1 minute' WHERE "orderId" = $1`,
            [n(placed.id)],
        );
        await service().reconcile();
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
    });

    it('sends a unique refund_trans_id, and follows a processing refund until it is refunded', async () => {
        const held = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(held.tranId, { amount: '20.00' }));
        const [attempt] = await attemptsOf(held.placed.id);
        expect(attempt.reviewState).toBe('open');

        mock.sslRefundAnswer = 'processing';
        const refunding = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunding).toMatchObject({ reviewState: 'refunding', refundReference: expect.any(String) });
        // Still listed for staff while the gateway processes it.
        const reviews = (await adminClient.query(REVIEWS)).bdPaymentReviews;
        expect(reviews.map((item: { id: string }) => item.id)).toContain(attempt.id);
        // A second refund can't be started meanwhile.
        expect(
            (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' })).reviewBdPayment.reason,
        ).toBe('NOT_OPEN');

        // Still processing at the next check, then refunded (Refund Query).
        const due = () =>
            db().query(
                `UPDATE bd_payment_attempt SET "nextCheckAt" = now() - interval '1 minute' WHERE id = $1`,
                [n(attempt.id)],
            );
        await due();
        await service().reconcile();
        expect((await attemptsOf(held.placed.id))[0].reviewState).toBe('refunding');
        mock.sslRefunds.get(refunding.refundReference)!.status = 'refunded';
        await due();
        await service().reconcile();
        const [done] = await attemptsOf(held.placed.id);
        expect(done.reviewState).toBe('refunded');
        expect(done.events).toEqual(expect.arrayContaining([{ source: 'refund-query', status: 'refunded' }]));

        // Every refund request had its own ID, within SSLCommerz's 30 characters.
        const ids = [...mock.sslRefunds.values()].map(refund => refund.refundTransId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id.length).toBeLessThanOrEqual(30);
    });

    it('puts a refund the gateway cancelled back in Payment reviews', async () => {
        const held = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(held.tranId, { amount: '30.00' }));
        const [attempt] = await attemptsOf(held.placed.id);
        mock.sslRefundAnswer = 'processing';
        const refunding = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        mock.sslRefunds.get(refunding.refundReference)!.status = 'cancelled';
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    checkBdPaymentAttempt(id: $id) {
                        id
                    }
                }
            `,
            { id: attempt.id },
        );
        expect((await attemptsOf(held.placed.id))[0]).toMatchObject({
            reviewState: 'open',
            refundReference: null,
        });
    });

    it('keeps the record of a refused refund, and a retry is a new refund', async () => {
        const held = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(held.tranId, { amount: '40.00' }));
        const [attempt] = await attemptsOf(held.placed.id);
        mock.sslRefundAnswer = 'failed';
        const refused = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refused.reason).toBe('REFUND_FAILED');
        const [after] = await attemptsOf(held.placed.id);
        expect(after.reviewState).toBe('open');
        expect(after.events).toEqual(expect.arrayContaining([{ source: 'refund', status: 'failed' }]));

        mock.sslRefundAnswer = 'success';
        const refunded = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunded.reviewState).toBe('refunded');
    });

    it('opens one gateway page for parallel starts and reloads, not a new try each time', async () => {
        await readyToPay();
        const placed = await pay('bd-sslcommerz', { purpose: 'full' });
        const { payUrl } = placed.payments[0].metadata.public;
        const sessions = mock.sslSessions;
        // The pay page's instant refresh and its button together, while SSLCommerz is slow to answer.
        mock.startDelayMs = 300;
        const [first, second] = await Promise.all([follow(payUrl), follow(payUrl)]);
        mock.startDelayMs = 0;
        expect(first).toMatch(/\/pay\/[a-f0-9]{30}$/);
        expect(second).toBe(first);
        expect(mock.sslSessions).toBe(sessions + 1);
        // A reload a moment later goes back to the same page.
        expect(await follow(payUrl)).toBe(first);
        expect(await attemptsOf(placed.id)).toHaveLength(1);
        // Ten minutes on, a reload opens a fresh try (the old page may be closed), and only one.
        await db().query(
            `UPDATE bd_payment_attempt SET "startedAt" = now() - interval '11 minutes' WHERE "orderId" = $1`,
            [n(placed.id)],
        );
        const fresh = await follow(payUrl);
        expect(fresh).not.toBe(first);
        expect(await follow(payUrl)).toBe(fresh);
        expect(await attemptsOf(placed.id)).toHaveLength(2);
    });

    it('cancelling an order cancels its online payment; money that comes later is held, never settled', async () => {
        const { placed, tranId } = await placeSsl();
        expect((await adminClient.query(CANCEL, { id: placed.id })).cancelBdOrder.state).toBe('Cancelled');
        expect((await orderById(placed.id)).payments).toMatchObject([{ state: 'Cancelled' }]);
        // The shopper was still on SSLCommerz's page and paid: the IPN goes to Payment reviews.
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(tranId));
        const [attempt] = await attemptsOf(placed.id);
        expect(attempt).toMatchObject({ status: 'paid', reviewReason: 'late', reviewState: 'open' });
        const order = await orderById(placed.id);
        expect(order.state).toBe('Cancelled');
        expect(order.payments).toMatchObject([{ state: 'Cancelled' }]);
    });

    it('holds money for an order cancelled while its payment was left Pending (before this fix)', async () => {
        const { placed, tranId } = await placeSsl();
        await adminClient.query(CANCEL, { id: placed.id });
        // As orders cancelled by staff used to be: the payment still Pending.
        await db().query(`UPDATE payment SET state = 'Pending' WHERE "orderId" = $1`, [n(placed.id)]);
        mock.sslPay(tranId); // paid, no IPN: reconciliation finds it
        await dueNow(placed.id);
        await service().reconcile();
        expect((await attemptsOf(placed.id))[0]).toMatchObject({
            status: 'paid',
            reviewReason: 'late',
            reviewState: 'open',
        });
        const order = await orderById(placed.id);
        expect(order.state).toBe('Cancelled');
        expect(order.payments).toMatchObject([{ state: 'Pending' }]);
    });

    it('never retries a refund whose answer was lost, and keeps it as processing for staff', async () => {
        const held = await placeSsl();
        await postForm('/bd-pay/sslcommerz/ipn', mock.sslPay(held.tranId, { amount: '50.00' }));
        const [attempt] = await attemptsOf(held.placed.id);
        const requests = mock.sslRefundRequests;
        mock.sslRefundAnswer = 'drop';
        const unknown = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        // Not "refused": it may have gone through. And the GET wasn't sent again by the HTTP client.
        expect(unknown.reason).toBe('REFUND_UNKNOWN');
        expect(mock.sslRefundRequests).toBe(requests + 1);
        expect((await attemptsOf(held.placed.id))[0]).toMatchObject({
            reviewState: 'refunding',
            refundReference: null,
        });
        // Nobody can refund it again meanwhile.
        mock.sslRefundAnswer = 'success';
        expect(
            (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' })).reviewBdPayment.reason,
        ).toBe('NOT_OPEN');
        expect(mock.sslRefundRequests).toBe(requests + 1);
        // SSLCommerz can't be asked without its refund reference: staff check its panel and resolve it.
        await dueNow(held.placed.id);
        await service().reconcile();
        expect(await attemptRow(held.placed.id)).toMatchObject({
            reviewState: 'refunding',
            nextCheckAt: null,
        });
        const resolved = (
            await adminClient.query(REVIEW, {
                id: attempt.id,
                action: 'resolve',
                note: 'Refunded, seen in the panel',
            })
        ).reviewBdPayment;
        expect(resolved.reviewState).toBe('resolved');
    });

    it('offers SSLCommerz only from ৳10 to ৳5,00,000', async () => {
        // 400 panjabis: ৳5,00,000 plus delivery.
        await readyToPay('prepaid', 400);
        const { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions.online.map((option: { gateway: string }) => option.gateway)).toEqual([
            'bkash',
        ]);
        const refused = await pay('bd-sslcommerz', { purpose: 'full' });
        expect(refused.paymentErrorMessage).toContain('৳10');
    });
});

describe('bKash', () => {
    async function placeBkash(choice: 'prepaid' | 'cod' = 'prepaid', purpose = 'full') {
        await readyToPay(choice);
        const placed = await pay('bd-bkash-online', { purpose });
        const page = await follow(placed.payments[0].metadata.public.payUrl);
        const paymentId = page.split('/bkash/pay/')[1]!;
        const payment = bk.bkash.get(paymentId)!;
        return { placed, paymentId, payment };
    }

    /** bKash sends the shopper back with the paymentID, the outcome and the payment's signature. */
    const callback = (
        payment: { callbackUrl: string; paymentId: string; signature: string },
        status: string,
        signature = payment.signature,
    ) =>
        follow(
            `${payment.callbackUrl}?paymentID=${payment.paymentId}&status=${status}&signature=${signature}`,
        );

    /** A bKash payment made after its order expired: held in Payment reviews for a refund. */
    async function lateBkashPayment() {
        const { placed, payment } = await placeBkash();
        await db().query(`UPDATE "order" SET "orderPlacedAt" = now() - interval '50 minutes' WHERE id = $1`, [
            n(placed.id),
        ]);
        expect(await service().expire()).toBeGreaterThanOrEqual(1);
        bk.bkashApprove(payment.paymentId);
        await callback(payment, 'success');
        const [attempt] = await attemptsOf(placed.id);
        expect(attempt).toMatchObject({ reviewReason: 'late', reviewState: 'open' });
        return { attempt, payment, placed };
    }

    it('executes on the success callback and settles', async () => {
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        expect(await callback(payment, 'success')).toContain('payment=paid');
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
        const [attempt] = await attemptsOf(placed.id);
        expect(attempt.gatewayTransactionId).toMatch(/^TRX/);
        expect(attempt.payerAccount).toBe('********678');
    });

    it('sends v2 requests: the shopper’s phone, an amount with two decimals', async () => {
        const { payment } = await placeBkash();
        expect(payment.amount).toBe('1310.00');
        // The wallet number is filled in on bKash's page.
        expect(payment.payerReference).toMatch(/^0171300\d{4}$/);
    });

    it('reuses one token, and never makes a third token call in an hour', async () => {
        for (let i = 0; i < 3; i++) await placeBkash();
        expect(bk.bkashTokenCalls).toEqual(['grant']);
        // bKash revokes it: one refresh (the second call this hour) and the payment goes on.
        bk.bkashRevokeTokens();
        await placeBkash();
        expect(bk.bkashTokenCalls).toEqual(['grant', 'refresh']);
        // Revoked again: a third call would block the store's bKash for an hour, so it isn't made.
        bk.bkashRevokeTokens();
        await readyToPay();
        const placed = await pay('bd-bkash-online', { purpose: 'full' });
        expect(await follow(placed.payments[0].metadata.public.payUrl)).toContain('payment=unavailable');
        expect(bk.bkashTokenCalls).toEqual(['grant', 'refresh']);
    });

    it('executes once: a second callback and reconciliation only ask', async () => {
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        const results = await Promise.all([callback(payment, 'success'), callback(payment, 'success')]);
        expect(results.some(url => url.includes('payment=paid'))).toBe(true);
        expect(await callback(payment, 'success')).toContain('payment=paid');
        await db().query(
            `UPDATE bd_payment_attempt SET "nextCheckAt" = now() - interval '1 minute' WHERE "orderId" = $1`,
            [n(placed.id)],
        );
        await service().reconcile();
        expect(payment.executes).toBe(1);
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
    });

    it('never executes on a callback with the wrong signature', async () => {
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        expect(await callback(payment, 'success', 'forged')).toContain('payment=pending');
        expect(payment.executes).toBe(0);
        expect((await attemptsOf(placed.id))[0].status).toBe('started');
        // bKash's own callback still works.
        expect(await callback(payment, 'success')).toContain('payment=paid');
    });

    it('offers Pay again after a cancel or a failure', async () => {
        const { placed, payment } = await placeBkash();
        expect(await callback(payment, 'cancel')).toContain('payment=cancelled');
        const token = await trackingToken(placed.id);
        let tracked = (await shopClient.query(TRACK, { token })).bdTrackOrderByToken;
        expect(tracked.onlinePayment).toMatchObject({ gateway: 'bkash', lastFailure: 'cancelled' });

        const retry = bk.bkash.get((await payAgain(placed.id)).split('/bkash/pay/')[1]!)!;
        expect(await callback(retry, 'failure')).toContain('payment=failed');
        tracked = (await shopClient.query(TRACK, { token })).bdTrackOrderByToken;
        expect(tracked.onlinePayment).toMatchObject({ gateway: 'bkash', lastFailure: 'failed' });
        expect((await orderById(placed.id)).state).toBe('AwaitingPayment');
    });

    it('asks Refund Status after a refund that timed out, and never refunds twice', async () => {
        const { attempt, payment } = await lateBkashPayment();
        bk.bkashRefund = 'drop';
        const refunded = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunded).toMatchObject({
            reviewState: 'refunded',
            refundReference: expect.stringMatching(/^RF1/),
        });
        expect(payment.refunds).toHaveLength(1);
        expect(bk.bkashCalls.filter(path => path === 'refund/payment/transaction')).toHaveLength(1);
        expect(bk.bkashCalls).toContain('refund/payment/status');
    });

    it('refuses a refund above what bKash can still refund', async () => {
        bk.bkashMaxRefundable = '100.00';
        const { attempt, payment } = await lateBkashPayment();
        const refused = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        // A code staff see in their language, with the most bKash can still refund.
        expect(refused).toMatchObject({ reason: 'REFUND_TOO_MUCH', detail: '৳100.00' });
        expect(payment.refunds).toHaveLength(0);
        expect(bk.bkashCalls).not.toContain('refund/payment/transaction');
    });

    it('starts bKash once for parallel starts, so its callback is still accepted', async () => {
        await readyToPay();
        const placed = await pay('bd-bkash-online', { purpose: 'full' });
        const { payUrl } = placed.payments[0].metadata.public;
        bk.startDelayMs = 300;
        const pages = await Promise.all([follow(payUrl), follow(payUrl), follow(payUrl)]);
        bk.startDelayMs = 0;
        expect(new Set(pages).size).toBe(1);
        expect(bk.bkashCalls.filter(path => path === 'payment/create')).toHaveLength(1);
        const payment = bk.bkash.get(pages[0]!.split('/bkash/pay/')[1]!)!;
        bk.bkashApprove(payment.paymentId);
        expect(await callback(payment, 'success')).toContain('payment=paid');
    });

    it('holds a payment made after staff cancelled the order (found by reconciliation)', async () => {
        const { placed, payment } = await placeBkash();
        await adminClient.query(CANCEL, { id: placed.id });
        expect((await orderById(placed.id)).payments).toMatchObject([{ state: 'Cancelled' }]);
        // The shopper finished on bKash's page; no callback reached us.
        bk.bkashCompleteLate(payment.paymentId);
        await dueNow(placed.id);
        await service().reconcile();
        expect((await attemptsOf(placed.id))[0]).toMatchObject({
            status: 'paid',
            reviewReason: 'late',
            reviewState: 'open',
        });
        expect((await orderById(placed.id)).state).toBe('Cancelled');
    });

    it('keeps asking after an execute that timed out, and pays the order when bKash finishes late', async () => {
        bk.bkashExecute = 'timeout';
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        // No answer to Execute and the query says Initiated: the shopper is told it failed...
        expect(await callback(payment, 'success')).toContain('payment=failed');
        expect(await attemptRow(placed.id)).toMatchObject({
            status: 'failed',
            nextCheckAt: expect.any(Date),
        });
        // ...asking again while it's still Initiated changes nothing...
        await dueNow(placed.id);
        await service().reconcile();
        expect(await attemptRow(placed.id)).toMatchObject({
            status: 'failed',
            nextCheckAt: expect.any(Date),
        });
        // ...and bKash finishing it late pays the order.
        bk.bkashCompleteLate(payment.paymentId);
        await dueNow(placed.id);
        await service().reconcile();
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
        expect((await attemptsOf(placed.id))[0].status).toBe('paid');
    });

    it('stops asking after a clear refusal from bKash', async () => {
        bk.bkashExecute = '2023';
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        expect(await callback(payment, 'success')).toContain('payment=failed');
        expect(await attemptRow(placed.id)).toMatchObject({ status: 'failed', nextCheckAt: null });
    });

    it('follows a refund bKash is still processing, and never sends a second one meanwhile', async () => {
        const { attempt, payment, placed } = await lateBkashPayment();
        bk.bkashRefund = 'pending';
        const refunding = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunding).toMatchObject({
            reviewState: 'refunding',
            refundReference: expect.stringMatching(/^RF1/),
        });
        // Even when it's up for a decision again (as after a lost answer) and bKash's 10 minutes
        // have passed, the refund in progress is followed: no second refund is sent.
        await db().query(
            `UPDATE bd_payment_attempt SET "reviewState" = 'open', "refundTransId" = NULL, "refundRequestedAt" = now() - interval '20 minutes' WHERE id = $1`,
            [n(attempt.id)],
        );
        payment.refunds[0]!.at -= 20 * 60_000;
        bk.bkashRefund = 'complete';
        const again = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' })).reviewBdPayment;
        expect(again).toMatchObject({ reviewState: 'refunding', refundReference: refunding.refundReference });
        expect(payment.refunds).toHaveLength(1);
        // bKash finishes it: Refund Status says Completed.
        payment.refunds[0]!.status = 'Completed';
        await dueNow(placed.id);
        await service().reconcile();
        expect(await attemptRow(placed.id)).toMatchObject({ reviewState: 'refunded', nextCheckAt: null });
    });

    it('a refund that never reached bKash goes back to staff, and a new refund then works', async () => {
        const { attempt, payment, placed } = await lateBkashPayment();
        bk.bkashRefund = 'lost';
        const unknown = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(unknown.reason).toBe('REFUND_UNKNOWN');
        expect(await attemptRow(placed.id)).toMatchObject({ reviewState: 'refunding' });
        // Refund Status lists nothing 10 minutes on: it never arrived, so staff decide again.
        await db().query(
            `UPDATE bd_payment_attempt SET "refundRequestedAt" = now() - interval '11 minutes' WHERE id = $1`,
            [n(attempt.id)],
        );
        await dueNow(placed.id);
        await service().reconcile();
        expect(await attemptRow(placed.id)).toMatchObject({ reviewState: 'open' });
        bk.bkashRefund = 'complete';
        const refunded = (await adminClient.query(REVIEW, { id: attempt.id, action: 'refund' }))
            .reviewBdPayment;
        expect(refunded.reviewState).toBe('refunded');
        expect(payment.refunds).toHaveLength(1);
    });

    it('looks up a transaction for staff on a support call', async () => {
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        await callback(payment, 'success');
        const [attempt] = await attemptsOf(placed.id);
        const found = (await adminClient.query(LOOK_UP, { id: attempt.id })).bdLookupBkashTransaction;
        expect(found).toMatchObject({ status: 'Completed', amount: TOTAL, payerAccount: '********678' });
    });

    it('settles from the query when execute times out after taking the money', async () => {
        bk.bkashExecute = 'drop';
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        expect(await callback(payment, 'success')).toContain('payment=paid');
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
    });

    it('says why it failed, lets the shopper retry, and ignores a callback for another payment', async () => {
        bk.bkashExecute = '2023';
        const { placed, payment } = await placeBkash();
        bk.bkashApprove(payment.paymentId);
        // The query says Failed; execute's reason (insufficient balance) reaches the shopper.
        expect(await callback(payment, 'success')).toContain('payment=failed&reason=insufficientBalance');
        const order = await orderById(placed.id);
        expect(order.state).toBe('AwaitingPayment');
        const tracked = (await shopClient.query(TRACK, { token: await trackingToken(placed.id) }))
            .bdTrackOrderByToken;
        expect(tracked).toMatchObject({
            status: 'awaitingPayment',
            timeline: [{ status: 'awaitingPayment' }],
            onlinePayment: {
                gateway: 'bkash',
                purpose: 'full',
                amount: TOTAL,
                lastFailure: 'insufficientBalance',
                // bKash's own words, in the store's language (Bangla here).
                lastFailureMessage: 'অপর্যাপ্ত ব্যালেন্স',
            },
        });
        expect(
            await follow(
                `${core}/bd-pay/bkash/callback/${(await attemptsOf(placed.id))[0].id}x?paymentID=TRnope&status=success`,
            ),
        ).toBe('https://shop.example.com/');

        bk.bkashExecute = 'complete';
        const retryPage = await payAgain(placed.id);
        const retry = bk.bkash.get(retryPage.split('/bkash/pay/')[1]!)!;
        bk.bkashApprove(retry.paymentId);
        expect(await callback(retry, 'success')).toContain('payment=paid');
        expect((await orderById(placed.id)).state).toBe('PaymentSettled');
    });

    it('takes an online advance, with cash on delivery for the rest', async () => {
        const settings = defaultPaymentSettings();
        await adminClient.query(UPDATE_PAYMENT_SETTINGS, {
            input: {
                ...settings,
                advance: { ...settings.advance, enabled: true, rule: 'delivery', scope: 'all' },
            },
        });
        await readyToPay('cod');
        const { bdPaymentOptions } = await shopClient.query(OPTIONS);
        const advance = bdPaymentOptions.advanceAmount;
        expect(advance).toBe(tk(60));
        const started = await pay('bd-bkash-online', { purpose: 'advance' });
        expect(started.state).toBe('ArrangingPayment');
        const placed = await pay('bd-cod', {});
        expect(placed.state).toBe('AwaitingPayment');
        // In no particular order: Vendure doesn't sort an order's payments.
        expect(placed.payments).toHaveLength(2);
        expect(placed.payments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ method: 'bd-bkash-online', amount: advance, state: 'Pending' }),
                expect.objectContaining({
                    method: 'bd-cod',
                    amount: bdPaymentOptions.codAmount,
                    state: 'Authorized',
                }),
            ]),
        );
        const online = placed.payments.find((item: { method: string }) => item.method === 'bd-bkash-online');
        const page = await follow(online.metadata.public.payUrl);
        const payment = bk.bkash.get(page.split('/bkash/pay/')[1]!)!;
        bk.bkashApprove(payment.paymentId);
        await callback(payment, 'success');
        const order = await orderById(placed.id);
        expect(order).toMatchObject({
            state: 'PaymentAuthorized',
            bd: { status: 'new', paidAmount: advance },
        });
    });
});

describe('permissions', () => {
    it('refuses review decisions and setup to shoppers', async () => {
        await shopClient.asAnonymousUser();
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(REVIEWS)).rejects.toThrow();
        await expect(adminClient.query(REVIEW, { id: '1', action: 'refund' })).rejects.toThrow();
        await expect(adminClient.query(SETUP)).rejects.toThrow();
    });
});

// Last: the open circuit lasts minutes.
describe('circuit breaker', () => {
    it('hides a failing gateway at checkout; cash on delivery still works', async () => {
        mock.sslSessionStatus = 503;
        for (let i = 0; i < 2; i++) {
            const { placed } = await (async () => {
                await readyToPay();
                return { placed: await pay('bd-sslcommerz', { purpose: 'full' }) };
            })();
            // A POST isn't retried: each try is one failure for the circuit breaker.
            for (let tries = 0; tries < 3; tries++) {
                // Each "Pay now" opens a new try at the gateway, which refuses with a 503.
                await payAgain(placed.id);
            }
        }
        await readyToPay();
        const { bdPaymentOptions } = await shopClient.query(OPTIONS);
        expect(bdPaymentOptions.online.map((option: { gateway: string }) => option.gateway)).toEqual([
            'bkash',
        ]);
        await shopClient.query(CHOICE, { choice: 'cod' });
        expect((await pay('bd-cod', {})).state).toBe('PaymentAuthorized');
    });
});

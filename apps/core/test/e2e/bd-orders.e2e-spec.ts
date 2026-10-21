import { EventBus, RequestContextService, TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    BdOrderCancelledWithReasonEvent,
    BdOrderConfirmedEvent,
    BdOrderPackedEvent,
    BdOrderReturnedEvent,
    OrderActionsService,
} from '../../src/plugins/bd-orders';
import {
    ADD_ITEM,
    KUSHTIA,
    payAndPlace,
    placePhoneOrder,
    prepareCheckout,
    SET_CUSTOMER,
    TRANSITION,
} from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3055;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;
const shopUrl = `http://localhost:${PORT}/shop-api`;

const BD_ORDER = gql`
    fragment BdOrder on Order {
        id
        code
        state
        totalWithTax
        customFields {
            orderNumber
        }
        bd {
            status
            paymentType
            paidAmount
            codDue
            cancelReason
            cancelNote
            callAttempts
            queueAt
            claim {
                name
                mine
            }
            possibleDuplicateOf
            suggestCancel
            imported
        }
    }
`;

const ACTION_RESULT = `
    ... on Order { ...BdOrder }
    ... on BdOrderActionError { errorCode reason message currentStatus changedBy changedAt details }
`;

const mutation = (name: string, inputType: string) => gql`
    mutation ($input: ${inputType}!) {
        ${name}(input: $input) {
            ${ACTION_RESULT}
        }
    }
    ${BD_ORDER}
`;

const CONFIRM = mutation('confirmBdOrder', 'BdConfirmOrderInput');
const CANCEL = mutation('cancelBdOrder', 'BdCancelOrderInput');
const PACK = mutation('packBdOrder', 'BdOrderActionInput');
const SHIP = mutation('markBdOrderShipped', 'BdOrderActionInput');
const DELIVER = mutation('markBdOrderDelivered', 'BdOrderActionInput');
const RETURN = mutation('markBdOrderReturned', 'BdReturnOrderInput');
const CALL = mutation('recordBdCallAttempt', 'BdCallAttemptInput');
const CLAIM = gql`
    mutation ($orderId: ID!) {
        claimBdOrder(orderId: $orderId) {
            ${ACTION_RESULT}
        }
    }
    ${BD_ORDER}
`;

const ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            ...BdOrder
            history(options: { sort: { createdAt: DESC }, take: 50 }) {
                items {
                    type
                    data
                    administrator {
                        firstName
                    }
                }
            }
        }
    }
    ${BD_ORDER}
`;

const QUEUE = gql`
    query ($snoozed: Boolean) {
        bdConfirmationQueue(snoozed: $snoozed, take: 100) {
            totalItems
            items {
                id
                customFields {
                    orderNumber
                }
            }
        }
    }
`;

const ORDERS = gql`
    query (
        $status: String
        $search: String
        $districtId: String
        $paymentType: String
        $dateFrom: String
        $dateTo: String
    ) {
        bdOrders(
            status: $status
            search: $search
            districtId: $districtId
            paymentType: $paymentType
            dateFrom: $dateFrom
            dateTo: $dateTo
            take: 100
        ) {
            totalItems
            items {
                id
                customFields {
                    orderNumber
                }
            }
        }
    }
`;

const STATS = gql`
    query ($date: String) {
        bdOrderStats(date: $date) {
            dayStart
            todayOrders
            todaySales
            waitingConfirmation
            confirmedNotPacked
        }
    }
`;

let phoneCounter = 0;
/** A new Bangladeshi mobile number for each order, so rate limits and duplicates never interfere. */
const nextPhone = () => `0181${String(++phoneCounter).padStart(7, '0')}`;

/** Places an order (fresh session) and returns it as the admin sees it. */
async function newOrder(
    input: { phone?: string; variantId?: string; quantity?: number; name?: string } = {},
) {
    const placed = await placePhoneOrder(shopClient, { phone: input.phone ?? nextPhone(), ...input });
    return adminOrder(placed.id);
}

async function adminOrder(id: string) {
    return (await adminClient.query(ORDER, { id })).order;
}

const raw = (id: string) => id.replace(/^T_/, '');

async function sql(query: string, parameters: unknown[] = []) {
    return server.app.get(TransactionalConnection).rawConnection.query(query, parameters);
}

async function setPlacedAt(id: string, date: Date) {
    await sql(`UPDATE "order" SET "orderPlacedAt" = $1 WHERE id = $2`, [date, raw(id)]);
}

async function queueNumbers(snoozed = false): Promise<string[]> {
    const { bdConfirmationQueue } = await adminClient.query(QUEUE, { snoozed });
    return bdConfirmationQueue.items.map(
        (item: { customFields: { orderNumber: string } }) => item.customFields.orderNumber,
    );
}

async function createStaff(email: string, firstName: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        {
            roles(options: { take: 50 }) {
                items {
                    id
                    code
                    permissions
                }
            }
        }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
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
                firstName,
                lastName: 'Staff',
                emailAddress: email,
                password: 'staff-password-123',
                roleIds: [role.id],
            },
        },
    );
    const client = new SimpleGraphQLClient(config, adminUrl);
    await client.asUserWithCredentials(email, 'staff-password-123');
    return { client, permissions: role.permissions as string[] };
}

const events: Array<{ type: string; orderId: string; staff: string | null }> = [];

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const eventBus = server.app.get(EventBus);
    for (const [type, event] of [
        ['confirmed', BdOrderConfirmedEvent],
        ['packed', BdOrderPackedEvent],
        ['returned', BdOrderReturnedEvent],
        ['cancelled', BdOrderCancelledWithReasonEvent],
    ] as const) {
        eventBus
            .ofType(event)
            .subscribe(e => events.push({ type, orderId: String(e.order.id), staff: e.staff.name }));
    }
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('order numbers and the queue', () => {
    it('shows the first COD order placed through the API as #1001 New in the confirmation queue', async () => {
        const order = await newOrder();
        expect(order.customFields.orderNumber).toBe('1001');
        expect(order.bd).toMatchObject({
            status: 'new',
            paymentType: 'cod',
            paidAmount: 0,
            codDue: order.totalWithTax,
        });
        expect(await queueNumbers()).toEqual(['1001']);
    });

    it('gives abandoned carts no number: the next order is 1002', async () => {
        for (let cart = 0; cart < 3; cart++) {
            await shopClient.asAnonymousUser();
            await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
            await shopClient.query(SET_CUSTOMER, { input: { name: 'Window shopper', phone: nextPhone() } });
        }
        expect((await newOrder()).customFields.orderNumber).toBe('1002');
    });

    it('gives 200 orders placed at the same moment 200 unique, consecutive numbers', async () => {
        const shoppers = Array.from({ length: 200 }, () => new SimpleGraphQLClient(config, shopUrl));
        // Fill the carts in batches, then place all 200 at once.
        for (let start = 0; start < shoppers.length; start += 25) {
            await Promise.all(
                shoppers.slice(start, start + 25).map(async shopper => {
                    await prepareCheckout(shopper, { phone: nextPhone() });
                    await shopper.query(TRANSITION, { state: 'ArrangingPayment' });
                }),
            );
        }
        const placed = await Promise.all(
            shoppers.map(shopper =>
                shopper.query(gql`
                    mutation {
                        addPaymentToOrder(input: { method: "test-payment", metadata: {} }) {
                            ... on Order {
                                customFields {
                                    orderNumber
                                }
                            }
                        }
                    }
                `),
            ),
        );
        const numbers = placed
            .map(result => Number(result.addPaymentToOrder.customFields.orderNumber))
            .sort((a, b) => a - b);
        expect(new Set(numbers).size).toBe(200);
        expect(numbers[0]).toBe(1003);
        expect(numbers[199]).toBe(1202);
        // Clear them from the queue so later tests start with a short one.
        await sql(
            `UPDATE "order" SET "customFieldsConfirmqueueat" = NULL WHERE "customFieldsOrdernumber"::int >= 1003`,
        );
    }, 180_000);

    it('uses the prefix from the order settings', async () => {
        const { bdOrderSettings } = await adminClient.query(gql`
            {
                bdOrderSettings
            }
        `);
        const UPDATE = gql`
            mutation ($input: JSON!) {
                updateBdOrderSettings(input: $input) {
                    settings
                    errors {
                        path
                        code
                    }
                }
            }
        `;
        const bad = await adminClient.query(UPDATE, {
            input: { ...bdOrderSettings, orderNumberPrefix: 'TOO-LONG!' },
        });
        expect(bad.updateBdOrderSettings.errors).toEqual([{ path: 'orderNumberPrefix', code: 'invalid' }]);
        await adminClient.query(UPDATE, { input: { ...bdOrderSettings, orderNumberPrefix: 'mf' } });
        const order = await newOrder();
        expect(order.customFields.orderNumber).toMatch(/^MF-\d{4}$/);
        await adminClient.query(UPDATE, { input: bdOrderSettings });
        await adminClient.query(CANCEL, { input: { orderId: order.id, reason: 'duplicate' } });
    });

    it('moves an unanswered order down, hides a "call later" one until then, and logs each call', async () => {
        await sql(`UPDATE "order" SET "customFieldsConfirmqueueat" = NULL`);
        const first = await newOrder();
        const second = await newOrder();
        const [a, b] = [first.customFields.orderNumber, second.customFields.orderNumber];
        expect(await queueNumbers()).toEqual([a, b]);

        const noAnswer = await adminClient.query(CALL, { input: { orderId: first.id, outcome: 'noAnswer' } });
        expect(noAnswer.recordBdCallAttempt.bd.callAttempts).toBe(1);
        expect(await queueNumbers()).toEqual([b, a]);

        const callBackAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
        const later = await adminClient.query(CALL, {
            input: { orderId: second.id, outcome: 'callLater', callBackAt, note: 'At the office until 5' },
        });
        expect(later.recordBdCallAttempt.bd).toMatchObject({ callAttempts: 0, queueAt: callBackAt });
        expect(await queueNumbers()).toEqual([a]);
        expect(await queueNumbers(true)).toEqual([b]);

        const history = (await adminOrder(second.id)).history.items;
        expect(history.find((entry: { type: string }) => entry.type === 'BD_CALL_ATTEMPT')).toMatchObject({
            data: { outcome: 'callLater', callBackAt, note: 'At the office until 5' },
            administrator: { firstName: 'Super' },
        });

        const past = await adminClient.query(CALL, {
            input: {
                orderId: second.id,
                outcome: 'callLater',
                callBackAt: new Date(Date.now() - 1000).toISOString(),
            },
        });
        expect(past.recordBdCallAttempt.reason).toBe('INVALID_TIME');
        const confirmed = await adminClient.query(CONFIRM, { input: { orderId: first.id } });
        expect(confirmed.confirmBdOrder.bd).toMatchObject({ status: 'confirmed', queueAt: null });
        const notQueued = await adminClient.query(CALL, {
            input: { orderId: first.id, outcome: 'noAnswer' },
        });
        expect(notQueued.recordBdCallAttempt.reason).toBe('NOT_IN_QUEUE');
        expect(await queueNumbers()).toEqual([]);
    });

    it('never puts an imported order in the queue, though it appears in lists', async () => {
        await sql(`UPDATE "order" SET "customFieldsConfirmqueueat" = NULL`);
        const order = await newOrder();
        await sql(`UPDATE "order" SET "customFieldsImported" = true WHERE id = $1`, [raw(order.id)]);
        expect(await queueNumbers()).toEqual([]);
        const { bdOrders } = await adminClient.query(ORDERS, { search: order.customFields.orderNumber });
        expect(bdOrders.items.map((item: { id: string }) => item.id)).toEqual([order.id]);
        await sql(`UPDATE "order" SET "customFieldsImported" = false WHERE id = $1`, [raw(order.id)]);
        await adminClient.query(CANCEL, { input: { orderId: order.id, reason: 'fake' } });
    });
});

describe('the order workflow', () => {
    it('goes New → Confirmed → Packed → Shipped → Delivered, recording who did each step', async () => {
        const order = await newOrder();
        const steps: Array<[typeof CONFIRM, string, string]> = [
            [CONFIRM, 'confirmBdOrder', 'confirmed'],
            [PACK, 'packBdOrder', 'packed'],
            [SHIP, 'markBdOrderShipped', 'shipped'],
            [DELIVER, 'markBdOrderDelivered', 'delivered'],
        ];
        let status = 'new';
        for (const [document, name, next] of steps) {
            const result = (
                await adminClient.query(document, { input: { orderId: order.id, expectedStatus: status } })
            )[name];
            expect(result.reason).toBeUndefined();
            expect(result.bd.status).toBe(next);
            status = next;
        }
        const { history } = await adminOrder(order.id);
        const transitions = history.items
            .filter((entry: { type: string }) => entry.type === 'ORDER_STATE_TRANSITION')
            .map((entry: { data: { to: string }; administrator: { firstName: string } | null }) => [
                entry.data.to,
                entry.administrator?.firstName,
            ]);
        expect(transitions).toEqual(
            expect.arrayContaining([
                ['Confirmed', 'Super'],
                ['Packed', 'Super'],
                ['Shipped', 'Super'],
                ['Delivered', 'Super'],
            ]),
        );
    });

    it('cancels from New, Confirmed and Packed (with a reason), and returns Shipped orders', async () => {
        const fromNew = await newOrder();
        const cancelled = await adminClient.query(CANCEL, {
            input: { orderId: fromNew.id, reason: 'fake', expectedStatus: 'new' },
        });
        expect(cancelled.cancelBdOrder.bd).toMatchObject({ status: 'cancelled', cancelReason: 'fake' });

        const fromConfirmed = await newOrder();
        await adminClient.query(CONFIRM, { input: { orderId: fromConfirmed.id } });
        const other = await adminClient.query(CANCEL, {
            input: { orderId: fromConfirmed.id, reason: 'other', note: 'Wants a different colour' },
        });
        expect(other.cancelBdOrder.bd).toMatchObject({
            status: 'cancelled',
            cancelNote: 'Wants a different colour',
        });

        const fromPacked = await newOrder();
        await adminClient.query(CONFIRM, { input: { orderId: fromPacked.id } });
        await adminClient.query(PACK, { input: { orderId: fromPacked.id } });
        expect(
            (await adminClient.query(CANCEL, { input: { orderId: fromPacked.id, reason: 'outOfStock' } }))
                .cancelBdOrder.bd.status,
        ).toBe('cancelled');

        const shipped = await newOrder();
        await adminClient.query(CONFIRM, { input: { orderId: shipped.id } });
        await adminClient.query(PACK, { input: { orderId: shipped.id } });
        await adminClient.query(SHIP, { input: { orderId: shipped.id } });
        const notCancelled = await adminClient.query(CANCEL, {
            input: { orderId: shipped.id, reason: 'customerCancelled' },
        });
        expect(notCancelled.cancelBdOrder).toMatchObject({ reason: 'NOT_ALLOWED', currentStatus: 'shipped' });
        const returned = await adminClient.query(RETURN, {
            input: { orderId: shipped.id, note: 'Refused at the door' },
        });
        expect(returned.markBdOrderReturned.bd.status).toBe('returned');
    });

    it('returns the undelivered part of a partly delivered order', async () => {
        // Two lines, two fulfillments: one delivered, one not.
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_2', quantity: 1 });
        await prepareCheckout(shopClient, { phone: nextPhone() });
        const twoLines = await adminOrder((await payAndPlace(shopClient)).id);
        await adminClient.query(CONFIRM, { input: { orderId: twoLines.id } });
        await adminClient.query(PACK, { input: { orderId: twoLines.id } });
        const { order: withLines } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        lines {
                            id
                            quantity
                        }
                    }
                }
            `,
            { id: twoLines.id },
        );
        const FULFIL = gql`
            mutation ($lines: [OrderLineInput!]!) {
                addFulfillmentToOrder(
                    input: {
                        lines: $lines
                        handler: {
                            code: "manual-fulfillment"
                            arguments: [
                                { name: "method", value: "Test" }
                                { name: "trackingCode", value: "" }
                            ]
                        }
                    }
                ) {
                    ... on Fulfillment {
                        id
                    }
                }
            }
        `;
        const TRANSITION_FULFILMENT = gql`
            mutation ($id: ID!, $state: String!) {
                transitionFulfillmentToState(id: $id, state: $state) {
                    ... on Fulfillment {
                        state
                    }
                }
            }
        `;
        const fulfillments = [];
        for (const line of withLines.lines) {
            const { addFulfillmentToOrder } = await adminClient.query(FULFIL, {
                lines: [{ orderLineId: line.id, quantity: line.quantity }],
            });
            fulfillments.push(addFulfillmentToOrder.id);
        }
        for (const id of fulfillments) {
            await adminClient.query(TRANSITION_FULFILMENT, { id, state: 'Shipped' });
        }
        await adminClient.query(TRANSITION_FULFILMENT, { id: fulfillments[0], state: 'Delivered' });
        expect((await adminOrder(twoLines.id)).bd.status).toBe('partiallyDelivered');
        const returned = await adminClient.query(RETURN, { input: { orderId: twoLines.id } });
        expect(returned.markBdOrderReturned.bd.status).toBe('returned');
    });

    it('refuses every shortcut with a clear typed error, not a server error', async () => {
        const order = await newOrder();
        expect((await adminClient.query(PACK, { input: { orderId: order.id } })).packBdOrder).toMatchObject({
            errorCode: 'BD_ORDER_ACTION_ERROR',
            reason: 'NOT_ALLOWED',
            currentStatus: 'new',
            message: 'This can’t be done with the order in its current status.',
        });
        expect(
            (await adminClient.query(SHIP, { input: { orderId: order.id } })).markBdOrderShipped.reason,
        ).toBe('NOT_ALLOWED');
        expect(
            (await adminClient.query(DELIVER, { input: { orderId: order.id } }, { languageCode: 'bn' }))
                .markBdOrderDelivered.message,
        ).toBe('অর্ডারের এখনকার অবস্থায় এটি করা যায় না।');
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        expect(
            (await adminClient.query(CONFIRM, { input: { orderId: order.id } })).confirmBdOrder,
        ).toMatchObject({
            reason: 'NOT_ALLOWED',
            currentStatus: 'confirmed',
            changedBy: 'Super Admin',
        });
        // Vendure's own mutations get the same rules.
        const ADMIN_TRANSITION = gql`
            mutation ($id: ID!, $state: String!) {
                transitionOrderToState(id: $id, state: $state) {
                    ... on OrderStateTransitionError {
                        transitionError
                    }
                }
            }
        `;
        const jump = await adminClient.query(ADMIN_TRANSITION, { id: order.id, state: 'Returned' });
        expect(jump.transitionOrderToState.transitionError).toBeTruthy();
        // Vendure's cancelOrder without a reason changes nothing: not the status, not the lines.
        const VENDURE_CANCEL = gql`
            mutation ($id: ID!) {
                cancelOrder(input: { orderId: $id }) {
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `;
        await expect(adminClient.query(VENDURE_CANCEL, { id: order.id })).rejects.toThrow(
            'Choose a cancel reason before cancelling a placed order.',
        );
        await expect(
            adminClient.query(VENDURE_CANCEL, { id: order.id }, { languageCode: 'bn' }),
        ).rejects.toThrow('অর্ডার বাতিলের আগে কারণ বেছে নিন।');
        const { order: after } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        state
                        lines {
                            quantity
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(after.state).toBe('Confirmed');
        expect(after.lines[0].quantity).toBe(1);
    });

    it('needs a valid reason to cancel, a note for "other", and refuses when money was received', async () => {
        const order = await newOrder();
        expect(
            (await adminClient.query(CANCEL, { input: { orderId: order.id, reason: 'bored' } })).cancelBdOrder
                .reason,
        ).toBe('INVALID_REASON');
        expect(
            (await adminClient.query(CANCEL, { input: { orderId: order.id, reason: 'other' } })).cancelBdOrder
                .reason,
        ).toBe('NOTE_REQUIRED');
        const { order: withPayments } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        payments {
                            id
                        }
                    }
                }
            `,
            { id: order.id },
        );
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    settlePayment(id: $id) {
                        ... on Payment {
                            state
                        }
                    }
                }
            `,
            { id: withPayments.payments[0].id },
        );
        const prepaid = await adminOrder(order.id);
        expect(prepaid.bd).toMatchObject({ status: 'new', paymentType: 'prepaid', codDue: 0 });
        expect(
            (await adminClient.query(CANCEL, { input: { orderId: order.id, reason: 'fake' } })).cancelBdOrder
                .reason,
        ).toBe('REFUND_REQUIRED');
        // Packing a prepaid order without a call needs the store setting.
        expect((await adminClient.query(PACK, { input: { orderId: order.id } })).packBdOrder.reason).toBe(
            'NOT_ALLOWED',
        );
        const { bdOrderSettings } = await adminClient.query(gql`
            {
                bdOrderSettings
            }
        `);
        const UPDATE = gql`
            mutation ($input: JSON!) {
                updateBdOrderSettings(input: $input) {
                    errors {
                        code
                    }
                }
            }
        `;
        await adminClient.query(UPDATE, { input: { ...bdOrderSettings, skipConfirmationForPrepaid: true } });
        expect((await adminClient.query(PACK, { input: { orderId: order.id } })).packBdOrder.bd.status).toBe(
            'packed',
        );
        await adminClient.query(UPDATE, { input: bdOrderSettings });
    });

    it('warns when stock ran out after the order was placed, and confirms anyway on request', async () => {
        const order = await newOrder({ variantId: 'T_2', quantity: 3 });
        await adminClient.query(gql`
            mutation {
                updateProductVariants(input: [{ id: "T_2", stockOnHand: 2 }]) {
                    id
                }
            }
        `);
        const warned = await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        expect(warned.confirmBdOrder).toMatchObject({
            reason: 'INSUFFICIENT_STOCK',
            details: ['Silk Saree'],
        });
        const anyway = await adminClient.query(CONFIRM, {
            input: { orderId: order.id, ignoreStockWarning: true },
        });
        expect(anyway.confirmBdOrder.bd.status).toBe('confirmed');
        await adminClient.query(gql`
            mutation {
                updateProductVariants(input: [{ id: "T_2", stockOnHand: 100 }]) {
                    id
                }
            }
        `);
    });

    it('flags the same items from the same phone within 30 minutes as a possible duplicate', async () => {
        const phone = nextPhone();
        const first = await newOrder({ phone });
        const second = await newOrder({ phone });
        const different = await newOrder({ phone, quantity: 2 });
        expect(first.bd.possibleDuplicateOf).toBeNull();
        expect(second.bd.possibleDuplicateOf).toBe(first.customFields.orderNumber);
        expect(different.bd.possibleDuplicateOf).toBeNull();
        const cancelled = await adminClient.query(CANCEL, {
            input: { orderId: second.id, reason: 'duplicate' },
        });
        expect(cancelled.cancelBdOrder.bd).toMatchObject({ status: 'cancelled', cancelReason: 'duplicate' });
    });
});

describe('two staff on one order', () => {
    let karim: SimpleGraphQLClient;

    beforeAll(async () => {
        karim = (await createStaff('karim@example.com', 'Karim', 'order-staff')).client;
    });

    it('confirms once when two staff confirm at the same moment; the other sees who did it', async () => {
        const order = await newOrder();
        const results = await Promise.all([
            karim.query(CONFIRM, { input: { orderId: order.id, expectedStatus: 'new' } }),
            adminClient.query(CONFIRM, { input: { orderId: order.id, expectedStatus: 'new' } }),
        ]);
        const outcomes = results.map(result => result.confirmBdOrder);
        const winners = outcomes.filter(outcome => outcome.bd?.status === 'confirmed');
        const losers = outcomes.filter(outcome => outcome.reason === 'ALREADY_CHANGED');
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]).toMatchObject({
            currentStatus: 'confirmed',
            changedBy: expect.stringMatching(/Karim|Super Admin/),
        });
        expect(new Date(losers[0].changedAt).getTime()).toBeLessThanOrEqual(Date.now());
        const transitions = (await adminOrder(order.id)).history.items.filter(
            (entry: { type: string; data: { to: string } }) =>
                entry.type === 'ORDER_STATE_TRANSITION' && entry.data.to === 'Confirmed',
        );
        expect(transitions).toHaveLength(1);
    });

    it('shows "Karim is calling" to others for 5 minutes, then lets someone else take over', async () => {
        const order = await newOrder();
        const claimed = await karim.query(CLAIM, { orderId: order.id });
        expect(claimed.claimBdOrder.bd.claim).toEqual({ name: 'Karim Staff', mine: true });
        const seenByOther = await adminClient.query(CLAIM, { orderId: order.id });
        expect(seenByOther.claimBdOrder.bd.claim).toEqual({ name: 'Karim Staff', mine: false });
        // Karim closed the browser: the claim runs out.
        await sql(`UPDATE "order" SET "customFieldsClaimeduntil" = $1 WHERE id = $2`, [
            new Date(Date.now() - 60_000),
            raw(order.id),
        ]);
        const takenOver = await adminClient.query(CLAIM, { orderId: order.id });
        expect(takenOver.claimBdOrder.bd.claim).toEqual({ name: 'Super Admin', mine: true });
        const released = await adminClient.query(
            gql`
                mutation ($orderId: ID!) {
                    releaseBdOrderClaim(orderId: $orderId)
                }
            `,
            { orderId: order.id },
        );
        expect(released.releaseBdOrderClaim).toBe(true);
        expect((await adminOrder(order.id)).bd.claim).toBeNull();
    });

    it('bulk-confirms checked orders, each on its own', async () => {
        const [a, b] = [await newOrder(), await newOrder()];
        await adminClient.query(CONFIRM, { input: { orderId: b.id } });
        const { confirmBdOrders } = await adminClient.query(
            gql`
                mutation ($ids: [ID!]!) {
                    confirmBdOrders(orderIds: $ids) {
                        ${ACTION_RESULT}
                    }
                }
                ${BD_ORDER}
            `,
            { ids: [a.id, b.id] },
        );
        expect(confirmBdOrders[0].bd.status).toBe('confirmed');
        expect(confirmBdOrders[1]).toMatchObject({ reason: 'ALREADY_CHANGED', currentStatus: 'confirmed' });
    });
});

describe('permissions', () => {
    it('gives the default roles the new permissions', async () => {
        const { roles } = await adminClient.query(gql`
            {
                roles(options: { take: 50 }) {
                    items {
                        code
                        permissions
                    }
                }
            }
        `);
        const of = (code: string) =>
            roles.items.find((role: { code: string }) => role.code === code).permissions;
        expect(of('owner')).toEqual(
            expect.arrayContaining(['ConfirmOrder', 'CancelOrder', 'PackOrder', 'ReadSalesFigures']),
        );
        expect(of('order-staff')).toEqual(expect.arrayContaining(['ConfirmOrder', 'CancelOrder']));
        expect(of('order-staff')).not.toContain('PackOrder');
        expect(of('order-staff')).not.toContain('ReadSalesFigures');
        expect(of('packer')).toContain('PackOrder');
        expect(of('packer')).not.toContain('ConfirmOrder');
        expect(of('marketing')).toContain('ReadSalesFigures');
    });

    it('lets a packer pack but not confirm, and hides sales figures from order staff', async () => {
        const packer = (await createStaff('packer@example.com', 'Rana', 'packer')).client;
        const orderStaff = new SimpleGraphQLClient(config, adminUrl);
        await orderStaff.asUserWithCredentials('karim@example.com', 'staff-password-123');
        const order = await newOrder();
        await expect(packer.query(CONFIRM, { input: { orderId: order.id } })).rejects.toThrow(
            /not currently authorized/,
        );
        await orderStaff.query(CONFIRM, { input: { orderId: order.id } });
        await expect(orderStaff.query(PACK, { input: { orderId: order.id } })).rejects.toThrow(
            /not currently authorized/,
        );
        expect((await packer.query(PACK, { input: { orderId: order.id } })).packBdOrder.bd.status).toBe(
            'packed',
        );
        expect((await orderStaff.query(STATS)).bdOrderStats.todaySales).toBeNull();
        expect((await adminClient.query(STATS)).bdOrderStats.todaySales).toBeGreaterThan(0);
    });
});

describe('order lists and widgets', () => {
    it('finds orders by phone digits, order number, name, district and payment type, with counts', async () => {
        const phone = nextPhone();
        const order = await newOrder({ phone, name: 'Shahana Parvin' });
        const number = order.customFields.orderNumber;
        const ids = async (variables: Record<string, unknown>) =>
            (await adminClient.query(ORDERS, variables)).bdOrders.items.map(
                (item: { id: string }) => item.id,
            );
        expect(await ids({ search: phone.slice(-5) })).toContain(order.id);
        expect(await ids({ search: `#${number}` })).toEqual([order.id]);
        expect(await ids({ search: 'shahana' })).toContain(order.id);
        expect(await ids({ status: 'new', search: phone })).toEqual([order.id]);
        expect(await ids({ status: 'confirmed', search: phone })).toEqual([]);
        expect(await ids({ districtId: 'BD3026', search: phone })).toEqual([order.id]);
        expect(await ids({ districtId: KUSHTIA, search: phone })).toEqual([]);
        expect(await ids({ paymentType: 'cod', search: phone })).toEqual([order.id]);
        expect(await ids({ paymentType: 'prepaid', search: phone })).toEqual([]);

        const { bdOrderCounts } = await adminClient.query(gql`
            {
                bdOrderCounts {
                    status
                    count
                }
            }
        `);
        const counts = Object.fromEntries(
            bdOrderCounts.map((row: { status: string; count: number }) => [row.status, row.count]),
        );
        expect(Object.keys(counts)).toEqual([
            'new',
            'confirmed',
            'packed',
            'shipped',
            'partiallyDelivered',
            'delivered',
            'returned',
            'cancelled',
        ]);
        expect(counts.new).toBeGreaterThan(0);
        expect(counts.delivered).toBeGreaterThan(0);
    });

    it('counts an order at 23:59 Dhaka time for that day, though it is 17:59 UTC', async () => {
        const late = await newOrder();
        const nextDay = await newOrder();
        // Dates as parameters: the driver stores them the way Vendure does.
        await setPlacedAt(late.id, new Date('2026-03-10T17:59:00Z'));
        await setPlacedAt(nextDay.id, new Date('2026-03-10T18:00:00Z'));
        const tenth = (await adminClient.query(STATS, { date: '2026-03-10' })).bdOrderStats;
        expect(tenth).toMatchObject({
            dayStart: '2026-03-09T18:00:00.000Z',
            todayOrders: 1,
            todaySales: late.totalWithTax,
        });
        expect((await adminClient.query(STATS, { date: '2026-03-11' })).bdOrderStats.todayOrders).toBe(1);
        const { bdOrders } = await adminClient.query(ORDERS, {
            dateFrom: '2026-03-10',
            dateTo: '2026-03-10',
        });
        expect(bdOrders.items.map((item: { id: string }) => item.id)).toEqual([late.id]);
        await expect(adminClient.query(STATS, { date: '10/03/2026' })).rejects.toThrow(
            'Dates must look like 2026-10-21.',
        );
    });

    it('counts the work waiting: new orders to confirm, and confirmed orders not yet packed', async () => {
        const before = (await adminClient.query(STATS)).bdOrderStats;
        const order = await newOrder();
        const after = (await adminClient.query(STATS)).bdOrderStats;
        expect(after.waitingConfirmation).toBe(before.waitingConfirmation + 1);
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        const confirmed = (await adminClient.query(STATS)).bdOrderStats;
        expect(confirmed.confirmedNotPacked).toBe(before.confirmedNotPacked + 1);
        expect(confirmed.todayOrders).toBe(before.todayOrders + 1);
    });
});

describe('events and auto-cancel', () => {
    it('fires our events for real orders, with the staff member, and never for imported ones', async () => {
        const real = await newOrder();
        await adminClient.query(CONFIRM, { input: { orderId: real.id } });
        await adminClient.query(PACK, { input: { orderId: real.id } });
        const imported = await newOrder();
        await sql(`UPDATE "order" SET "customFieldsImported" = true WHERE id = $1`, [raw(imported.id)]);
        await adminClient.query(CONFIRM, { input: { orderId: imported.id } });
        await adminClient.query(CANCEL, { input: { orderId: imported.id, reason: 'fake' } });
        await new Promise(resolve => setTimeout(resolve, 300));
        const forOrder = (id: string) =>
            events.filter(event => event.orderId === raw(id)).map(event => [event.type, event.staff]);
        expect(forOrder(real.id)).toEqual([
            ['confirmed', 'Super Admin'],
            ['packed', 'Super Admin'],
        ]);
        expect(forOrder(imported.id)).toEqual([]);
        expect(events.some(event => event.type === 'cancelled')).toBe(true);
        expect(events.some(event => event.type === 'returned')).toBe(true);
    });

    it('suggests cancelling unreachable orders, and cancels them only when the merchant turns that on', async () => {
        const order = await newOrder();
        await adminClient.query(CALL, { input: { orderId: order.id, outcome: 'noAnswer' } });
        await setPlacedAt(order.id, new Date(Date.now() - 2 * 24 * 60 * 60_000));
        const { bdOrderSettings } = await adminClient.query(gql`
            {
                bdOrderSettings
            }
        `);
        const UPDATE = gql`
            mutation ($input: JSON!) {
                updateBdOrderSettings(input: $input) {
                    errors {
                        code
                    }
                }
            }
        `;
        const rule = { suggest: true, afterDays: 1, minFailedCalls: 1, cancelAutomatically: false };
        await adminClient.query(UPDATE, { input: { ...bdOrderSettings, autoCancel: rule } });
        expect((await adminOrder(order.id)).bd.suggestCancel).toBe(true);
        const actions = server.app.get(OrderActionsService);
        // A new context per run, as the scheduled task gets (settings are read once per context).
        const context = () => server.app.get(RequestContextService).create({ apiType: 'admin' });
        expect(await actions.autoCancelUnreachable(await context())).toBe(0);
        expect((await adminOrder(order.id)).bd.status).toBe('new');

        await adminClient.query(UPDATE, {
            input: { ...bdOrderSettings, autoCancel: { ...rule, cancelAutomatically: true } },
        });
        expect(await actions.autoCancelUnreachable(await context())).toBeGreaterThanOrEqual(1);
        expect((await adminOrder(order.id)).bd).toMatchObject({
            status: 'cancelled',
            cancelReason: 'unreachable',
        });
        await adminClient.query(UPDATE, { input: bdOrderSettings });
    });
});

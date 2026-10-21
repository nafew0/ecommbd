import { takaToMinor } from '@ecommbd/shared';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DHAKA, MIRPUR } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3062;
const config = createTestConfig(PORT);
const { server, adminClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;

const tk = takaToMinor;
const SAVAR = 'BD30260072';
/** Panjabi T_1 costs ৳1,250 (500 in stock); saree T_2 ৳4,500 (5 in stock). */
const PANJABI = 'T_1';
const SAREE = 'T_2';

const ORDER_FIELDS = `
    id
    code
    state
    totalWithTax
    subTotalWithTax
    shippingWithTax
    customFields { orderNumber source sendSms customerNote deliveryChargeOverride }
    customer { id firstName customFields { phone } }
    lines { id quantity unitPriceWithTax productVariant { id } customFields { priceOverride originalUnitPrice } }
    surcharges { sku priceWithTax }
    payments { method amount state transactionId }
    bd { status paymentType paidAmount codDue }
`;

const RESULT = `
    ... on Order { ${ORDER_FIELDS} }
    ... on BdManualOrderError { errorCode reason message details }
`;

const CREATE = gql`
    mutation ($input: BdManualOrderInput!) {
        createBdManualOrder(input: $input) { ${RESULT} }
    }
`;

const QUOTE = gql`
    query ($input: BdManualOrderInput!) {
        bdManualOrderQuote(input: $input) {
            ... on BdManualOrderQuote {
                subTotal
                delivery
                discount
                codFee
                total
                paidNow
                codDue
                deliveryOptions {
                    name
                    price
                }
            }
            ... on BdManualOrderError {
                reason
                message
            }
        }
    }
`;

const EDIT = gql`
    mutation ($input: BdEditOrderInput!) {
        editBdOrder(input: $input) { ${RESULT} }
    }
`;

const HISTORY = gql`
    query ($id: ID!) {
        order(id: $id) {
            history(options: { sort: { createdAt: DESC }, take: 20 }) {
                items {
                    type
                    data
                }
            }
        }
    }
`;

let phoneSuffix = 2000;
const newPhone = () => `01714${String(++phoneSuffix).padStart(6, '0')}`;

const order = (patch: Record<string, unknown> = {}) => ({
    customer: { name: 'রহিমা খাতুন', phone: newPhone() },
    address: { districtId: DHAKA, thanaId: MIRPUR, streetLine1: 'বাসা ৭, রোড ২, মিরপুর ১০' },
    lines: [{ variantId: PANJABI, quantity: 2 }],
    payment: { type: 'cod' },
    source: 'messenger',
    ...patch,
});

async function create(input: Record<string, unknown>, client = adminClient) {
    return (await client.query(CREATE, { input })).createBdManualOrder;
}

async function staff(email: string, roleCode: string) {
    const { roles } = await adminClient.query(
        gql`
            query ($code: String!) {
                roles(options: { filter: { code: { eq: $code } } }) {
                    items {
                        id
                    }
                }
            }
        `,
        { code: roleCode },
    );
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
                emailAddress: email,
                password: 'staff-password-123',
                roleIds: [roles.items[0].id],
            },
        },
    );
    const client = new SimpleGraphQLClient(config, adminUrl);
    await client.asUserWithCredentials(email, 'staff-password-123');
    return client;
}

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 0,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('manual orders', () => {
    it('creates a Messenger COD order as New, with the delivery rules of the checkout', async () => {
        const placed = await create(order({ note: 'বিকেলে দিন', sendSms: false }));
        expect(placed).toMatchObject({
            state: 'PaymentAuthorized',
            subTotalWithTax: tk(2500),
            shippingWithTax: tk(60),
            totalWithTax: tk(2560),
            customFields: { source: 'messenger', sendSms: false, customerNote: 'বিকেলে দিন' },
            customer: { firstName: 'রহিমা খাতুন' },
            payments: [{ method: 'bd-cod', amount: tk(2560), state: 'Authorized' }],
            bd: { status: 'new', paymentType: 'cod', paidAmount: 0, codDue: tk(2560) },
        });
        expect(placed.customFields.orderNumber).toMatch(/^\d+$/);
    });

    it('creates it directly as Confirmed', async () => {
        const placed = await create(order({ confirm: true }));
        expect(placed.bd.status).toBe('confirmed');
    });

    it('records money already paid by bKash (and refuses its TrxID twice)', async () => {
        const paid = await create(
            order({ payment: { type: 'paid', method: 'bkash', transactionId: '8n7a6d5e4f' } }),
        );
        expect(paid).toMatchObject({
            state: 'PaymentSettled',
            payments: [
                { method: 'bd-bkash', amount: tk(2560), state: 'Settled', transactionId: '8N7A6D5E4F' },
            ],
            bd: { paymentType: 'prepaid', paidAmount: tk(2560), codDue: 0 },
        });
        const again = await create(
            order({ payment: { type: 'paid', method: 'bkash', transactionId: '8N7A6D5E4F' } }),
        );
        expect(again).toMatchObject({ reason: 'DUPLICATE_TRANSACTION_ID' });
    });

    it('takes an advance, and the rest on delivery', async () => {
        const placed = await create(
            order({
                payment: { type: 'advance', method: 'nagad', transactionId: 'NG12345678', amount: tk(200) },
            }),
        );
        expect(placed).toMatchObject({
            state: 'PaymentAuthorized',
            bd: { paymentType: 'advance', paidAmount: tk(200), codDue: tk(2360) },
        });
        expect(placed.payments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ method: 'bd-nagad', amount: tk(200), state: 'Settled' }),
                expect.objectContaining({ method: 'bd-cod', amount: tk(2360), state: 'Authorized' }),
            ]),
        );
    });

    it('uses a staff price, a discount and a typed delivery charge, keeping the original price', async () => {
        const placed = await create(
            order({
                lines: [{ variantId: PANJABI, quantity: 2, unitPrice: tk(1000) }],
                discount: tk(100),
                deliveryCharge: 0,
            }),
        );
        expect(placed).toMatchObject({
            // Vendure counts surcharges (the discount) in the subtotal.
            subTotalWithTax: tk(1900),
            shippingWithTax: 0,
            totalWithTax: tk(1900),
            lines: [
                {
                    unitPriceWithTax: tk(1000),
                    customFields: { priceOverride: tk(1000), originalUnitPrice: tk(1250) },
                },
            ],
            surcharges: [{ sku: 'BD-MANUAL-DISCOUNT', priceWithTax: -tk(100) }],
        });
    });

    it('quotes without saving anything', async () => {
        const before = (
            await adminClient.query(gql`
                {
                    orders {
                        totalItems
                    }
                }
            `)
        ).orders.totalItems;
        const { bdManualOrderQuote } = await adminClient.query(QUOTE, {
            input: order({
                address: { districtId: DHAKA, thanaId: SAVAR, streetLine1: 'Savar Bazar' },
                customer: { name: '', phone: '017' },
            }),
        });
        expect(bdManualOrderQuote).toMatchObject({
            subTotal: tk(2500),
            delivery: tk(100),
            total: tk(2600),
            codDue: tk(2600),
            deliveryOptions: [{ price: tk(100) }],
        });
        const after = (
            await adminClient.query(gql`
                {
                    orders {
                        totalItems
                    }
                }
            `)
        ).orders.totalItems;
        expect(after).toBe(before);
    });

    it('refuses more than the stock, a bad phone and an address without a thana', async () => {
        expect(await create(order({ lines: [{ variantId: SAREE, quantity: 6 }] }))).toMatchObject({
            reason: 'INSUFFICIENT_STOCK',
        });
        expect(await create(order({ customer: { name: 'R', phone: '02-9876543' } }))).toMatchObject({
            reason: 'INVALID_PHONE',
        });
        expect(
            await create(order({ address: { districtId: DHAKA, thanaId: 'BD5081M01', streetLine1: 'x' } })),
        ).toMatchObject({ reason: 'INVALID_ADDRESS', details: ['thana-not-in-district'] });
    });

    it('saves the address on the customer only when asked', async () => {
        const phone = newPhone();
        const placed = await create(order({ customer: { name: 'Karim', phone }, saveAddress: true }));
        const { customer } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    customer(id: $id) {
                        addresses {
                            streetLine1
                            customFields {
                                thanaId
                            }
                        }
                    }
                }
            `,
            { id: placed.customer.id },
        );
        expect(customer.addresses).toEqual([
            { streetLine1: 'বাসা ৭, রোড ২, মিরপুর ১০', customFields: { thanaId: MIRPUR } },
        ]);
    });

    it('lets order staff discount up to 10% but not change prices', async () => {
        const karim = await staff('karim.manual@example.com', 'order-staff');
        expect(
            await create(order({ lines: [{ variantId: PANJABI, quantity: 2, unitPrice: tk(1000) }] }), karim),
        ).toMatchObject({
            reason: 'PRICE_OVERRIDE_NOT_ALLOWED',
        });
        expect(await create(order({ discount: tk(300) }), karim)).toMatchObject({
            reason: 'DISCOUNT_TOO_LARGE',
            details: [String(tk(250))],
        });
        expect((await create(order({ discount: tk(250) }), karim)).totalWithTax).toBe(tk(2310));
    });
});

describe('editing orders before shipping', () => {
    it('changes a COD order: the amount due follows the new total, and the edit is in the history', async () => {
        const placed = await create(order());
        const line = placed.lines[0];
        const { editBdOrder } = await adminClient.query(EDIT, {
            input: {
                orderId: placed.id,
                expectedStatus: 'new',
                lines: [
                    { orderLineId: line.id, quantity: 3 },
                    { variantId: SAREE, quantity: 1 },
                ],
                note: 'Customer wants one more',
            },
        });
        expect(editBdOrder).toMatchObject({
            state: 'PaymentAuthorized',
            totalWithTax: tk(3750 + 4500 + 60),
            bd: { status: 'new', codDue: tk(3750 + 4500 + 60) },
        });
        expect(editBdOrder.payments.filter((p: { state: string }) => p.state === 'Authorized')).toEqual([
            expect.objectContaining({ method: 'bd-cod', amount: tk(8310) }),
        ]);
        const { order: withHistory } = await adminClient.query(HISTORY, { id: placed.id });
        const edit = withHistory.history.items.find(
            (item: { type: string }) => item.type === 'BD_ORDER_EDIT',
        );
        expect(edit.data).toMatchObject({
            before: { total: tk(2560), lines: [{ quantity: 2 }] },
            after: { total: tk(8310) },
            note: 'Customer wants one more',
        });
    });

    it('keeps a confirmed order confirmed, and moves it to another district', async () => {
        const placed = await create(order({ confirm: true }));
        const { editBdOrder } = await adminClient.query(EDIT, {
            input: {
                orderId: placed.id,
                expectedStatus: 'confirmed',
                lines: [{ orderLineId: placed.lines[0].id, quantity: 2 }],
                address: { districtId: 'BD5081', thanaId: 'BD50810072', streetLine1: 'Kazla, Rajshahi' },
            },
        });
        expect(editBdOrder).toMatchObject({
            shippingWithTax: tk(120),
            bd: { status: 'confirmed', codDue: tk(2620) },
        });
    });

    it('collects a prepaid order’s increase on delivery, and leaves a decrease to refund', async () => {
        const paid = await create(order({ payment: { type: 'paid', method: 'cash' } }));
        const { editBdOrder: more } = await adminClient.query(EDIT, {
            input: { orderId: paid.id, lines: [{ orderLineId: paid.lines[0].id, quantity: 3 }] },
        });
        expect(more).toMatchObject({
            totalWithTax: tk(3810),
            bd: { paidAmount: tk(2560), codDue: tk(1250) },
        });
        const { editBdOrder: less } = await adminClient.query(EDIT, {
            input: { orderId: paid.id, lines: [{ orderLineId: paid.lines[0].id, quantity: 1 }] },
        });
        // ৳2,560 received for a ৳1,310 order: a ৳1,250 refund is due, recorded once staff send it.
        expect(less).toMatchObject({ totalWithTax: tk(1310), bd: { paidAmount: tk(2560), codDue: 0 } });
        const { order: withRefunds } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        payments {
                            method
                            state
                            refunds {
                                id
                                total
                                state
                            }
                        }
                    }
                }
            `,
            { id: paid.id },
        );
        const cash = withRefunds.payments.find((p: { method: string }) => p.method === 'bd-staff');
        expect(cash.refunds).toEqual([expect.objectContaining({ total: tk(1250), state: 'Pending' })]);
        const { settleBdRefund } = await adminClient.query(
            gql`
                mutation ($input: BdSettleRefundInput!) {
                    settleBdRefund(input: $input) {
                        ... on Refund {
                            state
                            method
                            transactionId
                        }
                    }
                }
            `,
            { input: { refundId: cash.refunds[0].id, method: 'bkash', transactionId: 'RF99887766' } },
        );
        expect(settleBdRefund).toEqual({ state: 'Settled', method: 'bkash', transactionId: 'RF99887766' });
        const { order: after } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        bd {
                            paidAmount
                            codDue
                        }
                    }
                }
            `,
            { id: paid.id },
        );
        expect(after.bd).toEqual({ paidAmount: tk(1310), codDue: 0 });
    });

    it('refuses a stale screen, a shipped order and no change', async () => {
        const placed = await create(order({ confirm: true }));
        const lines = [{ orderLineId: placed.lines[0].id, quantity: 1 }];
        expect(
            (await adminClient.query(EDIT, { input: { orderId: placed.id, expectedStatus: 'new', lines } }))
                .editBdOrder,
        ).toMatchObject({
            reason: 'ALREADY_CHANGED',
        });
        expect(
            (
                await adminClient.query(EDIT, {
                    input: { orderId: placed.id, lines: [{ orderLineId: placed.lines[0].id, quantity: 2 }] },
                })
            ).editBdOrder,
        ).toMatchObject({ reason: 'NOTHING_CHANGED' });
        const action = (name: string) => gql`
            mutation ($input: BdOrderActionInput!) { ${name}(input: $input) { ... on Order { id } } }
        `;
        await adminClient.query(action('packBdOrder'), { input: { orderId: placed.id } });
        await adminClient.query(action('markBdOrderShipped'), { input: { orderId: placed.id } });
        expect(
            (await adminClient.query(EDIT, { input: { orderId: placed.id, lines } })).editBdOrder,
        ).toMatchObject({
            reason: 'NOT_EDITABLE',
        });
    });
});

import { TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placePhoneOrder } from '../support/checkout';
import { addMigrationOnlyObjects, createTestConfig, testInitialData, testProductsCsvPath } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3091;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;

const tk = (taka: number) => taka * 100;
const raw = (id: string) => id.replace(/^T_/, '');

const SET_COST = gql`
    mutation ($id: ID!, $cost: Int) {
        updateProductVariants(input: [{ id: $id, customFields: { unitCost: $cost } }]) {
            id
            customFields {
                unitCost
            }
        }
    }
`;
const PROFIT = gql`
    query ($id: ID!) {
        bdOrderProfit(orderId: $id) {
            belowCost
            sellingPrice { amount known source detail }
            discount { amount known source detail }
            deliveryCharged { amount known source detail }
            codFeeCharged { amount known source detail }
            productCost { amount known source detail }
            courierCharge { amount known source detail }
            codCharge { amount known source detail }
            gatewayFee { amount known source detail }
            profit { amount known source detail }
            lines { deliveredQuantity unitCost belowCost }
        }
    }
`;
const SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdCostSettings(input: $input) {
            settings
            errors { path code }
        }
    }
`;
const ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            shippingWithTax
            lines {
                id
                quantity
                linePriceWithTax
                customFields { unitCost returnedQuantity }
                productVariant { id }
            }
            bd { status }
        }
    }
`;

let phone = 1711090000;
const nextPhone = () => `+880${phone++}`;

async function place(input: { variantId?: string; quantity?: number } = {}) {
    return placePhoneOrder(shopClient, { phone: nextPhone(), area: 'Mirpur 10', ...input });
}

async function profitOf(id: string) {
    return (await adminClient.query(PROFIT, { id })).bdOrderProfit;
}

async function sql(query: string, parameters: unknown[] = []) {
    return server.app.get(TransactionalConnection).rawConnection.query(query, parameters);
}

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const saved = await adminClient.query(SETTINGS, {
        input: {
            courierFlat: tk(60),
            codCharge: { type: 'flat', flat: 0, percent: null },
            gatewayFeePercent: 0,
        },
    });
    expect(saved.updateBdCostSettings.errors).toEqual([]);
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('cost snapshot and profit', () => {
    it('shows unknown, never ৳0, when the variation has no cost', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: null });
        const order = await place();
        const profit = await profitOf(order.id);
        expect(profit.productCost).toEqual({ amount: null, known: false, source: 'costSnapshot', detail: null });
        expect(profit.profit).toEqual({ amount: null, known: false, source: 'order', detail: null });
        expect(JSON.stringify(profit.productCost)).not.toContain('"amount":0');
    });

    it('keeps the cost from when the order was placed', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
        const order = await place();
        const first = await profitOf(order.id);
        expect(first.productCost).toMatchObject({ amount: tk(400), known: true, source: 'costSnapshot' });
        expect(first.courierCharge).toMatchObject({ amount: tk(60), known: true, source: 'storeSetting' });
        expect(first.codCharge).toMatchObject({ amount: 0, known: true });
        expect(first.gatewayFee).toMatchObject({ amount: 0, known: true, source: 'noGateway' });
        expect(first.belowCost).toBe(false);
        expect(first.profit.amount).toBe(
            first.sellingPrice.amount -
                first.discount.amount +
                first.deliveryCharged.amount +
                first.codFeeCharged.amount -
                first.productCost.amount -
                first.courierCharge.amount -
                first.codCharge.amount -
                first.gatewayFee.amount,
        );
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(900) });
        expect((await profitOf(order.id)).productCost.amount).toBe(tk(400));
    });

    it('warns when the price is below cost and still places the order', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(2000) });
        const order = await place();
        const profit = await profitOf(order.id);
        expect(profit.belowCost).toBe(true);
        expect(profit.lines[0].belowCost).toBe(true);
        expect(profit.profit.known).toBe(true);
        expect(order.state).toBe('PaymentAuthorized');
    });

    it('recalculates an edit from the snapshot, and snapshots a new line at the cost then', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
        await adminClient.query(SET_COST, { id: 'T_2', cost: tk(1000) });
        const placed = await place();
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(900) });
        const before = await adminClient.query(ORDER, { id: placed.id });
        const line = before.order.lines[0];
        const edited = await adminClient.query(
            gql`
                mutation ($input: BdEditOrderInput!) {
                    editBdOrder(input: $input) {
                        ... on Order { id lines { quantity customFields { unitCost } productVariant { id } } }
                        ... on BdManualOrderError { reason message }
                    }
                }
            `,
            {
                input: {
                    orderId: placed.id,
                    expectedStatus: 'new',
                    lines: [
                        { orderLineId: line.id, quantity: 2 },
                        { variantId: 'T_2', quantity: 1 },
                    ],
                },
            },
        );
        expect(edited.editBdOrder.reason).toBeUndefined();
        const fresh = await adminClient.query(ORDER, { id: placed.id });
        const lines = fresh.order.lines as Array<{
            quantity: number;
            customFields: { unitCost: number | null };
            productVariant: { id: string };
        }>;
        const panjabi = lines.find(item => item.productVariant.id === 'T_1');
        const saree = lines.find(item => item.productVariant.id === 'T_2');
        expect(panjabi).toMatchObject({ quantity: 2, customFields: { unitCost: tk(400) } });
        expect(saree?.customFields.unitCost).toBe(tk(1000));
        const profit = await profitOf(placed.id);
        expect(profit.productCost.amount).toBe(tk(400) * 2 + tk(1000));
    });

    it('counts only what was delivered on a partial delivery, and does not guess an unrecorded split', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
        const unknownSplit = await place({ quantity: 2 });
        await ship(unknownSplit.id);
        // The status, without a delivered fulfillment or a recorded return: the split is unknown.
        await sql(`UPDATE "order" SET state = 'PartiallyDelivered' WHERE id = $1`, [raw(unknownSplit.id)]);
        expect((await profitOf(unknownSplit.id)).profit.amount).toBeNull();

        const partial = await place({ quantity: 2 });
        const packed = await adminClient.query(ORDER, { id: partial.id });
        await confirmAndPack(partial.id);
        await deliverUnits(packed.order.lines[0].id, 1);
        const profit = await profitOf(partial.id);
        expect(profit.lines[0].deliveredQuantity).toBe(1);
        expect(profit.productCost.amount).toBe(tk(400));
        expect(profit.sellingPrice.amount).toBe(packed.order.lines[0].linePriceWithTax / 2);
    });

    it('counts a return as nothing delivered, and a cancel before booking as no courier charge', async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: tk(400) });
        const returned = await place();
        await ship(returned.id);
        await adminClient.query(gql`
            mutation ($id: ID!) {
                markBdOrderReturned(input: { orderId: $id }) { ... on Order { bd { status } } }
            }
        `, { id: returned.id });
        const back = await profitOf(returned.id);
        expect(back.productCost).toMatchObject({ amount: 0, known: true });
        expect(back.sellingPrice.amount).toBe(0);
        expect(back.deliveryCharged.amount).toBe(0);
        expect(back.codCharge.source).toBe('notCollected');

        const cancelled = await place();
        await adminClient.query(gql`
            mutation ($id: ID!) {
                cancelBdOrder(input: { orderId: $id, reason: "customerCancelled" }) {
                    ... on Order { bd { status } }
                }
            }
        `, { id: cancelled.id });
        const profit = await profitOf(cancelled.id);
        expect(profit.courierCharge).toMatchObject({ amount: 0, known: true, source: 'notBooked' });
        expect(profit.productCost.amount).toBe(0);
        expect(profit.profit.amount).toBe(0);
    });
});

async function confirmAndPack(id: string) {
    await step(id, 'confirmBdOrder');
    await step(id, 'packBdOrder');
}

/** Delivers some units of one line. The order becomes partly delivered. */
async function deliverUnits(lineId: string, quantity: number) {
    const added = await adminClient.query(
        gql`
            mutation ($lineId: ID!, $quantity: Int!) {
                addFulfillmentToOrder(input: {
                    lines: [{ orderLineId: $lineId, quantity: $quantity }]
                    handler: { code: "manual-fulfillment", arguments: [
                        { name: "method", value: "Manual" }
                        { name: "trackingCode", value: "partial" }
                    ] }
                }) {
                    ... on Fulfillment { id }
                    ... on ErrorResult { errorCode message }
                }
            }
        `,
        { lineId, quantity },
    );
    const fulfillment = added.addFulfillmentToOrder;
    if (fulfillment.message) throw new Error(`fulfillment: ${fulfillment.errorCode} ${fulfillment.message}`);
    for (const state of ['Shipped', 'Delivered']) {
        const moved = await adminClient.query(
            gql`
                mutation ($id: ID!, $state: String!) {
                    transitionFulfillmentToState(id: $id, state: $state) {
                        ... on Fulfillment { state }
                        ... on FulfillmentStateTransitionError { transitionError }
                    }
                }
            `,
            { id: fulfillment.id, state },
        );
        if (moved.transitionFulfillmentToState.transitionError) {
            throw new Error(moved.transitionFulfillmentToState.transitionError);
        }
    }
}

async function ship(id: string) {
    await confirmAndPack(id);
    await step(id, 'markBdOrderShipped');
}

async function step(id: string, name: string) {
    const result = await adminClient.query(
        gql`
            mutation ($id: ID!) {
                ${name}(input: { orderId: $id }) {
                    ... on Order { bd { status } }
                    ... on BdOrderActionError { reason message }
                }
            }
        `,
        { id },
    );
    const payload = result[name];
    if (payload.reason) throw new Error(`${name}: ${payload.reason} ${payload.message}`);
}

describe('ReadCost', () => {
    const COST = tk(123);

    beforeAll(async () => {
        await adminClient.query(SET_COST, { id: 'T_1', cost: COST });
    });

    it('gives ReadCost to the owner and the manager only', async () => {
        const { roles } = await adminClient.query(gql`
            { roles(options: { take: 20 }) { items { code permissions } } }
        `);
        const of = (code: string) =>
            roles.items.find((role: { code: string }) => role.code === code).permissions as string[];
        expect(of('owner')).toContain('ReadCost');
        expect(of('manager')).toContain('ReadCost');
        for (const code of ['order-staff', 'packer', 'marketing']) expect(of(code)).not.toContain('ReadCost');
    });

    it('refuses cost in the API, on the product form, in the list and on a print', async () => {
        const order = await place();
        const staff = await staffClient('orders.cost@example.com', 'order-staff');
        await expect(staff.query(PROFIT, { id: order.id })).rejects.toThrow(/authorized/i);
        await expect(staff.query(gql`{ bdCostSettings }`)).rejects.toThrow(/authorized/i);
        await expect(
            staff.query(SETTINGS, {
                input: { courierFlat: 0, codCharge: { type: 'flat', flat: 0, percent: null }, gatewayFeePercent: 0 },
            }),
        ).rejects.toThrow(/authorized/i);

        const variants = await staff.query(gql`
            { productVariants(options: { take: 10 }) { items { sku customFields { unitCost } } } }
        `);
        expect(variants.productVariants.items.every((item: { customFields: { unitCost: null } }) => item.customFields.unitCost == null)).toBe(true);
        expect(JSON.stringify(variants)).not.toContain(String(COST));

        const lines = await staff.query(gql`
            query ($id: ID!) { order(id: $id) { lines { customFields { unitCost } } } }
        `, { id: order.id });
        expect(lines.order.lines[0].customFields.unitCost).toBeNull();
        expect(JSON.stringify(lines)).not.toContain(String(COST));

        const panjabi = await adminClient.query(gql`
            { productVariants(options: { filter: { sku: { eq: "PANJABI-1" } } }) { items { productId } } }
        `);
        const form = await staff.query(gql`
            query ($id: ID!) { bdProductForm(id: $id) }
        `, { id: panjabi.productVariants.items[0].productId });
        expect(JSON.stringify(form)).not.toContain(String(COST));

        const list = await staff.query(gql`
            query ($missing: Boolean) {
                all: bdProducts(take: 50) { totalItems items { cost margin costMissing } }
                missing: bdProducts(take: 50, costMissing: $missing) { totalItems }
            }
        `, { missing: true });
        expect(list.all.items.every((item: { cost: null; margin: null; costMissing: null }) => item.cost == null && item.margin == null && item.costMissing == null)).toBe(true);
        expect(list.missing.totalItems).toBe(list.all.totalItems);
        expect(JSON.stringify(list)).not.toContain(String(COST));

        const printed = await staff.query(gql`
            query ($id: ID!) {
                bdPrintData(orderIds: [$id], document: "invoice") {
                    orders { lines { name quantity unitPrice linePrice } subtotal total }
                }
            }
        `, { id: order.id });
        expect(JSON.stringify(printed)).not.toContain(String(COST));

        await expect(
            shopClient.query(gql`
                { products { items { variants { customFields { unitCost } } } } }
            `),
        ).rejects.toThrow(/unitCost|Cannot query/i);
    });

    it('refuses a settings editor who cannot see cost, and ignores a product save from that role', async () => {
        const { createRole } = await adminClient.query(gql`
            mutation {
                createRole(input: {
                    code: "settings-no-cost"
                    description: "Settings without cost"
                    permissions: [UpdateStoreSettings, ReadSettings, Authenticated]
                }) { id }
            }
        `);
        const editor = await administrator('settings.nocost@example.com', createRole.id);
        await expect(
            editor.query(SETTINGS, {
                input: { courierFlat: tk(10), codCharge: { type: 'flat', flat: 0, percent: null }, gatewayFeePercent: 0 },
            }),
        ).rejects.toThrow(/authorized|forbidden/i);
        const { bdCostSettings } = await adminClient.query(gql`{ bdCostSettings }`);
        expect(bdCostSettings.courierFlat).toBe(tk(60));

        const { createRole: productRole } = await adminClient.query(gql`
            mutation {
                createRole(input: {
                    code: "products-no-cost"
                    description: "Products without cost"
                    permissions: [ReadProduct, UpdateProduct, ReadCatalog, UpdateCatalog, Authenticated]
                }) { id }
            }
        `);
        const products = await administrator('products.nocost@example.com', productRole.id);
        await expect(products.query(SET_COST, { id: 'T_1', cost: tk(50) })).rejects.toThrow(/permission|authorized/i);
        const { productVariants } = await adminClient.query(gql`
            { productVariants(options: { filter: { sku: { eq: "PANJABI-1" } } }) { items { customFields { unitCost } } } }
        `);
        expect(productVariants.items[0].customFields.unitCost).toBe(COST);
    });
});

async function staffClient(email: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        { roles(options: { take: 20 }) { items { id code } } }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
    return administrator(email, role.id);
}

async function administrator(email: string, roleId: string) {
    await adminClient.query(
        gql`
            mutation ($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) { id }
            }
        `,
        {
            input: {
                firstName: 'Staff',
                lastName: 'Cost',
                emailAddress: email,
                password: 'staff-password-123',
                roleIds: [roleId],
            },
        },
    );
    const client = new SimpleGraphQLClient(config, adminUrl);
    await client.asUserWithCredentials(email, 'staff-password-123');
    return client;
}

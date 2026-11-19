import { formatBdPhone, formatBranchAddress } from '@ecommbd/shared';
import { defaultCourierSettings } from '@ecommbd/shared';
import { TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DHAKA, MIRPUR, placePhoneOrder } from '../support/checkout';
import { MockCouriers, STEADFAST_CREDENTIALS } from '../support/mock-couriers';
import { addMigrationOnlyObjects, createTestConfig, testInitialData, testProductsCsvPath } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3094;
const mock = new MockCouriers(4074);
const config = createTestConfig(PORT, {}, { courierBaseUrls: { steadfast: `${mock.url}/steadfast` } });
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;
const tk = (taka: number) => taka * 100;
const raw = (id: string | number) => Number(String(id).replace(/^T_/, ''));

const SAVE_BRANCH = gql`
    mutation ($id: ID, $input: JSON!) {
        saveBdBranch(id: $id, input: $input) {
            errors { path code }
            branch { id name phone districtId thanaId districtName thanaName addressLine note sellsOnline }
        }
    }
`;
const ADJUST = gql`
    mutation ($input: BdAdjustStockInput!) {
        adjustBdStock(input: $input) { id stockAfter }
    }
`;

beforeAll(async () => {
    await mock.start();
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 0,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    await adminClient.query(
        gql`
            mutation ($input: JSON!) {
                saveBdCourierCredentials(courier: "steadfast", mode: "live", input: $input) { errors { path } }
            }
        `,
        { input: STEADFAST_CREDENTIALS },
    );
}, 180_000);

afterAll(async () => {
    await server.destroy();
    await mock.stop();
});

function sql(text: string, params: unknown[] = []) {
    return server.app.get(TransactionalConnection).rawConnection.query(text, params);
}

async function variantId(sku: string): Promise<string> {
    const { productVariants } = await adminClient.query(gql`
        query ($sku: String!) {
            productVariants(options: { filter: { sku: { eq: $sku } } }) { items { id } }
        }
    `, { sku });
    return productVariants.items[0].id as string;
}

async function branches() {
    const { bdBranches } = await adminClient.query(gql`
        { bdBranches { id name sellsOnline } }
    `);
    return bdBranches as Array<{ id: string; name: string; sellsOnline: boolean }>;
}

async function stockAt(variant: string, locationId: string): Promise<{ onHand: number; allocated: number }> {
    const rows = (await sql(
        `SELECT "stockOnHand" AS "onHand", "stockAllocated" AS allocated
         FROM stock_level WHERE "productVariantId" = $1 AND "stockLocationId" = $2`,
        [raw(variant), raw(locationId)],
    )) as Array<{ onHand: number | string; allocated: number | string }>;
    return { onHand: Number(rows[0]?.onHand ?? 0), allocated: Number(rows[0]?.allocated ?? 0) };
}

async function setStock(variant: string, locationId: string, target: number) {
    const now = await stockAt(variant, locationId);
    if (now.onHand === target) return;
    await adminClient.query(ADJUST, {
        input: { variantId: variant, change: target - now.onHand, reason: 'recount', stockLocationId: locationId },
    });
}

async function saveBranch(input: Record<string, unknown>, id?: string) {
    const saved = await adminClient.query(SAVE_BRANCH, { id: id ?? null, input });
    expect(saved.saveBdBranch.errors).toEqual([]);
    return saved.saveBdBranch.branch as {
        id: string;
        name: string;
        phone: string | null;
        districtName: string;
        thanaName: string;
        addressLine: string;
        sellsOnline: boolean;
    };
}

const branchInput = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    phone: '01711100099',
    districtId: DHAKA,
    thanaId: MIRPUR,
    addressLine: 'Road 1',
    note: '',
    sellsOnline: false,
    ...extra,
});

async function supplier() {
    const saved = await adminClient.query(gql`
        mutation ($input: JSON!) {
            createBdSupplier(input: $input) { errors { path } supplier { id } }
        }
    `, { input: { name: 'Branch supplier', phone: '', address: '', note: '' } });
    expect(saved.createBdSupplier.errors).toEqual([]);
    return saved.createBdSupplier.supplier.id as string;
}

async function receivePurchase(variant: string, locationId: string | null, quantity: number) {
    const supplierId = await supplier();
    const created = await adminClient.query(gql`
        mutation ($input: JSON!) {
            createBdPurchase(input: $input) {
                errors { path }
                purchase { id lines { id } }
            }
        }
    `, {
        input: {
            supplierId,
            purchasedOn: '2026-11-19',
            note: '',
            delivery: 0,
            other: 0,
            discount: 0,
            paid: 0,
            branchId: locationId,
            lines: [{ id: null, variantId: variant, quantity, unitCost: tk(100) }],
        },
    });
    expect(created.createBdPurchase.errors).toEqual([]);
    const purchase = created.createBdPurchase.purchase as { id: string; lines: Array<{ id: string }> };
    await adminClient.query(gql`mutation ($id: ID!) { markBdPurchaseOrdered(id: $id) { id } }`, { id: purchase.id });
    await adminClient.query(gql`
        mutation ($id: ID!, $input: JSON!) { receiveBdPurchase(id: $id, input: $input) { id } }
    `, { id: purchase.id, input: { note: '', lines: [{ lineId: purchase.lines[0]!.id, quantity }] } });
    return purchase;
}

let phone = 1700;
async function place(variant: string, quantity: number) {
    phone += 1;
    const order = await placePhoneOrder(shopClient, {
        phone: `01712${String(phone).padStart(6, '0')}`,
        districtId: DHAKA,
        thanaId: MIRPUR,
        variantId: variant,
        quantity,
    });
    return order.id as string;
}

async function step(id: string, name: string) {
    const result = await adminClient.query(gql`
        mutation ($id: ID!) {
            ${name}(input: { orderId: $id }) {
                ... on Order { id }
                ... on BdOrderActionError { reason message }
            }
        }
    `, { id });
    const payload = result[name];
    if (payload.reason) throw new Error(`${name}: ${payload.reason} ${payload.message}`);
}

describe('branches and stock transfers', () => {
    it('leaves the original location’s stock alone and marks it as selling online', async () => {
        const panjabi = await variantId('PANJABI-1');
        const saree = await variantId('SAREE-1');
        const [shop] = await branches();
        expect(shop!.sellsOnline).toBe(true);
        expect(await stockAt(panjabi, shop!.id)).toMatchObject({ onHand: 500, allocated: 0 });
        expect(await stockAt(saree, shop!.id)).toMatchObject({ onHand: 5, allocated: 0 });
        await expect(adminClient.query(gql`mutation ($id: ID!) { deleteBdBranch(id: $id) }`, { id: shop!.id })).rejects.toThrow(
            /at least one branch/i,
        );
        const before = await stockAt(panjabi, shop!.id);
        await saveBranch(branchInput('Warehouse'));
        expect(await stockAt(panjabi, shop!.id)).toEqual(before);
        expect(await stockAt(saree, shop!.id)).toMatchObject({ onHand: 5, allocated: 0 });
    });

    it('receives and returns a purchase at the chosen branch, and a blank branch at the original one', async () => {
        const saree = await variantId('SAREE-1');
        const list = await branches();
        const shop = list.find(item => item.sellsOnline)!;
        const warehouse = list.find(item => item.name === 'Warehouse')!;
        await setStock(saree, shop.id, 5);
        await setStock(saree, warehouse.id, 0);
        const purchase = await receivePurchase(saree, warehouse.id, 2);
        expect(await stockAt(saree, warehouse.id)).toMatchObject({ onHand: 2 });
        expect(await stockAt(saree, shop.id)).toMatchObject({ onHand: 5 });
        const { bdPurchase } = await adminClient.query(gql`
            query ($id: ID!) { bdPurchase(id: $id) { lines { id received } branchId } }
        `, { id: purchase.id });
        await adminClient.query(gql`
            mutation ($id: ID!, $input: JSON!) { returnBdPurchase(id: $id, input: $input) { id } }
        `, { id: purchase.id, input: { lines: [{ lineId: bdPurchase.lines[0].id, quantity: 1 }] } });
        expect(await stockAt(saree, warehouse.id)).toMatchObject({ onHand: 1 });
        expect(await stockAt(saree, shop.id)).toMatchObject({ onHand: 5 });
        expect(bdPurchase.branchId).toBe(warehouse.id);

        await receivePurchase(saree, null, 1);
        expect(await stockAt(saree, shop.id)).toMatchObject({ onHand: 6 });
        expect(await stockAt(saree, warehouse.id)).toMatchObject({ onHand: 1 });
    });

    it('sells from the shipping branch, releases a cancel, and puts a return back once', async () => {
        const panjabi = await variantId('PANJABI-1');
        const shop = (await branches()).find(item => item.sellsOnline)!;
        await setStock(panjabi, shop.id, 20);
        const sold = await place(panjabi, 2);
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 20, allocated: 2 });
        const branch = await adminClient.query(gql`
            query ($id: ID!) { bdOrderBranch(orderId: $id) { branchId transferNeeded } }
        `, { id: sold });
        expect(branch.bdOrderBranch).toMatchObject({ branchId: shop.id, transferNeeded: false });

        const cancelled = await place(panjabi, 1);
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 20, allocated: 3 });
        await adminClient.query(gql`
            mutation ($input: BdCancelOrderInput!) {
                cancelBdOrder(input: $input) { ... on Order { id } ... on BdOrderActionError { reason } }
            }
        `, { input: { orderId: cancelled, reason: 'fake', expectedStatus: 'new' } });
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 20, allocated: 2 });

        await step(sold, 'confirmBdOrder');
        await step(sold, 'packBdOrder');
        await step(sold, 'markBdOrderShipped');
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 18, allocated: 0 });
        await step(sold, 'markBdOrderReturned');
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 20, allocated: 0 });
        await step(sold, 'markBdOrderReturned').catch(() => undefined);
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 20, allocated: 0 });
    });

    it('puts back only what the customer did not keep when a partly delivered order comes back', async () => {
        const panjabi = await variantId('PANJABI-1');
        const shop = (await branches()).find(item => item.sellsOnline)!;
        await setStock(panjabi, shop.id, 20);
        const id = await place(panjabi, 2);
        await step(id, 'confirmBdOrder');
        await step(id, 'packBdOrder');
        const { order } = await adminClient.query(gql`
            query ($id: ID!) { order(id: $id) { lines { id } } }
        `, { id });
        // Two parcels of one unit each, both shipped; the courier delivers the first only.
        const parcels: string[] = [];
        for (let index = 0; index < 2; index += 1) {
            const added = await adminClient.query(gql`
                mutation ($lineId: ID!) {
                    addFulfillmentToOrder(input: {
                        lines: [{ orderLineId: $lineId, quantity: 1 }]
                        handler: { code: "manual-fulfillment", arguments: [
                            { name: "method", value: "Manual" }
                            { name: "trackingCode", value: "" }
                        ] }
                    }) { ... on Fulfillment { id } ... on ErrorResult { errorCode message } }
                }
            `, { lineId: order.lines[0].id });
            expect(added.addFulfillmentToOrder.id).toBeTruthy();
            parcels.push(added.addFulfillmentToOrder.id);
        }
        const move = (parcel: string, state: string) =>
            adminClient.query(gql`
                mutation ($id: ID!, $state: String!) {
                    transitionFulfillmentToState(id: $id, state: $state) { ... on Fulfillment { state } }
                }
            `, { id: parcel, state });
        for (const parcel of parcels) await move(parcel, 'Shipped');
        await move(parcels[0]!, 'Delivered');
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 18, allocated: 0 });
        await step(id, 'markBdOrderReturned');
        // The delivered unit stays with the customer; only the other one is back on the shelf.
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 19, allocated: 0 });
    });

    it('flags an order whose stock is only at another branch, and sells from that branch', async () => {
        const saree = await variantId('SAREE-1');
        const list = await branches();
        const shop = list.find(item => item.sellsOnline)!;
        const warehouse = list.find(item => item.name === 'Warehouse')!;
        await setStock(saree, shop.id, 0);
        await setStock(saree, warehouse.id, 4);
        const id = await place(saree, 1);
        const { bdOrderBranch } = await adminClient.query(gql`
            query ($id: ID!) { bdOrderBranch(orderId: $id) { branchId transferNeeded } }
        `, { id });
        expect(bdOrderBranch).toMatchObject({ branchId: shop.id, transferNeeded: true });
        expect(await stockAt(saree, shop.id)).toMatchObject({ onHand: 0, allocated: 0 });
        expect(await stockAt(saree, warehouse.id)).toMatchObject({ onHand: 4, allocated: 1 });
        await step(id, 'confirmBdOrder');
        await step(id, 'packBdOrder');
        await step(id, 'markBdOrderShipped');
        expect(await stockAt(saree, warehouse.id)).toMatchObject({ onHand: 3, allocated: 0 });
        expect(await stockAt(saree, shop.id)).toMatchObject({ onHand: 0, allocated: 0 });
    });

    it('sends only free units, keeps them in transit, and receives them without going over', async () => {
        const panjabi = await variantId('PANJABI-1');
        const list = await branches();
        const shop = list.find(item => item.sellsOnline)!;
        const warehouse = list.find(item => item.name === 'Warehouse')!;
        await setStock(panjabi, shop.id, 10);
        await setStock(panjabi, warehouse.id, 0);
        const held = await place(panjabi, 4);
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 10, allocated: 4 });
        await expect(
            adminClient.query(gql`
                mutation ($input: JSON!) { sendBdTransfer(input: $input) { transfer { id } errors { path } } }
            `, { input: { fromId: shop.id, toId: warehouse.id, note: '', lines: [{ variantId: panjabi, quantity: 8 }] } }),
        ).rejects.toThrow(/already in an order/i);
        await adminClient.query(gql`mutation ($input: BdCancelOrderInput!) {
            cancelBdOrder(input: $input) { ... on Order { id } }
        }`, { input: { orderId: held, reason: 'fake', expectedStatus: 'new' } });

        await expect(
            adminClient.query(gql`
                mutation ($input: JSON!) { sendBdTransfer(input: $input) { transfer { id } } }
            `, { input: { fromId: shop.id, toId: warehouse.id, note: '', lines: [{ variantId: panjabi, quantity: 11 }] } }),
        ).rejects.toThrow(/doesn’t have that many/i);

        const sent = await adminClient.query(gql`
            mutation ($input: JSON!) {
                sendBdTransfer(input: $input) {
                    errors { path }
                    transfer { id number status lines { id quantity received inTransit } }
                }
            }
        `, { input: { fromId: shop.id, toId: warehouse.id, note: '', lines: [{ variantId: panjabi, quantity: 6 }] } });
        expect(sent.sendBdTransfer.errors).toEqual([]);
        const transfer = sent.sendBdTransfer.transfer;
        expect(transfer.status).toBe('sent');
        expect(transfer.lines[0]).toMatchObject({ quantity: 6, received: 0, inTransit: 6 });
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 4 });
        expect(await stockAt(panjabi, warehouse.id)).toMatchObject({ onHand: 0 });

        await expect(
            adminClient.query(gql`
                mutation ($id: ID!, $input: JSON!) { receiveBdTransfer(id: $id, input: $input) { id } }
            `, { id: transfer.id, input: { lines: [{ lineId: transfer.lines[0].id, quantity: 7 }] } }),
        ).rejects.toThrow(/only receive what was sent/i);

        const partial = await adminClient.query(gql`
            mutation ($id: ID!, $input: JSON!) {
                receiveBdTransfer(id: $id, input: $input) { status lines { received inTransit } }
            }
        `, { id: transfer.id, input: { lines: [{ lineId: transfer.lines[0].id, quantity: 2 }] } });
        expect(partial.receiveBdTransfer.status).toBe('partial');
        expect(partial.receiveBdTransfer.lines[0]).toMatchObject({ received: 2, inTransit: 4 });
        expect(await stockAt(panjabi, warehouse.id)).toMatchObject({ onHand: 2 });

        const done = await adminClient.query(gql`
            mutation ($id: ID!, $input: JSON!) {
                receiveBdTransfer(id: $id, input: $input) { status lines { received inTransit } }
            }
        `, { id: transfer.id, input: { lines: [{ lineId: transfer.lines[0].id, quantity: 4 }] } });
        expect(done.receiveBdTransfer.status).toBe('received');
        expect(done.receiveBdTransfer.lines[0]).toMatchObject({ received: 6, inTransit: 0 });
        expect(await stockAt(panjabi, warehouse.id)).toMatchObject({ onHand: 6 });
        expect(await stockAt(panjabi, shop.id)).toMatchObject({ onHand: 4 });
    });

    it('refuses to delete a branch that holds stock or has held stock, and allows an unused one', async () => {
        const list = await branches();
        const warehouse = list.find(item => item.name === 'Warehouse')!;
        await expect(adminClient.query(gql`mutation ($id: ID!) { deleteBdBranch(id: $id) }`, { id: warehouse.id })).rejects.toThrow(
            /still has stock/i,
        );
        const panjabi = await variantId('PANJABI-1');
        const shop = list.find(item => item.sellsOnline)!;
        const there = await stockAt(panjabi, warehouse.id);
        if (there.onHand > 0) {
            await adminClient.query(gql`
                mutation ($input: JSON!) { sendBdTransfer(input: $input) { errors { path } } }
            `, {
                input: {
                    fromId: warehouse.id,
                    toId: shop.id,
                    note: '',
                    lines: [{ variantId: panjabi, quantity: there.onHand }],
                },
            });
        }
        const saree = await variantId('SAREE-1');
        const sareeThere = await stockAt(saree, warehouse.id);
        if (sareeThere.onHand > 0) {
            await setStock(saree, shop.id, (await stockAt(saree, shop.id)).onHand + sareeThere.onHand);
            await setStock(saree, warehouse.id, 0);
        }
        expect((await stockAt(panjabi, warehouse.id)).onHand).toBe(0);
        await expect(adminClient.query(gql`mutation ($id: ID!) { deleteBdBranch(id: $id) }`, { id: warehouse.id })).rejects.toThrow(
            /already held stock/i,
        );
        const unused = await saveBranch(branchInput('Empty shed'));
        const removed = await adminClient.query(gql`mutation ($id: ID!) { deleteBdBranch(id: $id) }`, { id: unused.id });
        expect(removed.deleteBdBranch).toBe(true);
        expect((await branches()).some(item => item.id === unused.id)).toBe(false);
    });

    it('copies the pickup branch onto the booking and keeps the old copy', async () => {
        const settings = defaultCourierSettings();
        const pickup = await saveBranch(branchInput('Pickup shop', { addressLine: 'Lane 4', sellsOnline: false }));
        await adminClient.query(gql`
            mutation ($input: JSON!) { updateBdCourierSettings(input: $input) { errors { path } } }
        `, {
            input: { ...settings, steadfast: { enabled: true }, defaultByZone: { ...settings.defaultByZone, dhaka_city: 'steadfast' } },
        });
        await adminClient.query(gql`
            mutation ($input: JSON!) {
                updateBdBranchSettings(input: $input) { errors { path } settings }
            }
        `, {
            input: {
                transferPrefix: 'ST',
                zoneBranch: { dhaka_city: '', dhaka_suburb: '', chattogram_city: '', outside_dhaka: '' },
                pickupBranch: { steadfast: pickup.id, pathao: '' },
            },
        });
        const panjabi = await variantId('PANJABI-1');
        const shop = (await branches()).find(item => item.sellsOnline)!;
        await setStock(panjabi, shop.id, 10);
        const first = await place(panjabi, 1);
        await step(first, 'confirmBdOrder');
        await step(first, 'packBdOrder');
        const booked = await adminClient.query(gql`
            mutation ($orderId: ID!, $courier: String) {
                bookBdCourier(orderId: $orderId, courier: $courier) {
                    ... on BdCourierBooking { id status pickupAddress pickupBranchId }
                    ... on BdCourierError { reason message }
                }
            }
        `, { orderId: first, courier: 'steadfast' });
        const expected = formatBranchAddress({
            name: pickup.name,
            addressLine: 'Lane 4',
            thana: pickup.thanaName,
            district: pickup.districtName,
            phone: formatBdPhone('01711100099'),
        });
        expect(booked.bookBdCourier.status).toBe('booked');
        expect(booked.bookBdCourier.pickupAddress).toBe(expected);
        expect(booked.bookBdCourier.pickupBranchId).toBe(pickup.id);

        await saveBranch(branchInput('Pickup shop', { addressLine: 'Lane 9', sellsOnline: false }), pickup.id);
        const second = await place(panjabi, 1);
        await step(second, 'confirmBdOrder');
        await step(second, 'packBdOrder');
        const again = await adminClient.query(gql`
            mutation ($orderId: ID!) {
                bookBdCourier(orderId: $orderId, courier: "steadfast") {
                    ... on BdCourierBooking { pickupAddress }
                }
            }
        `, { orderId: second });
        const { bdCourierBooking } = await adminClient.query(gql`
            query ($orderId: ID!) { bdCourierBooking(orderId: $orderId) { pickupAddress } }
        `, { orderId: first });
        expect(bdCourierBooking.pickupAddress).toBe(expected);
        expect(again.bookBdCourier.pickupAddress).toContain('Lane 9');
        expect(again.bookBdCourier.pickupAddress).not.toBe(expected);
    });

    it('refuses a role that cannot see branches', async () => {
        const { createRole } = await adminClient.query(gql`
            mutation {
                createRole(input: {
                    code: "orders-no-branch"
                    description: "Orders without branches"
                    permissions: [ReadOrder, ReadProduct, UpdateProduct, Authenticated]
                }) { id }
            }
        `);
        await adminClient.query(gql`
            mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }
        `, {
            input: {
                firstName: 'Staff',
                lastName: 'Branch',
                emailAddress: 'orders.nobranch@example.com',
                password: 'staff-password-123',
                roleIds: [createRole.id],
            },
        });
        const staff = new SimpleGraphQLClient(config, adminUrl);
        await staff.asUserWithCredentials('orders.nobranch@example.com', 'staff-password-123');
        await expect(staff.query(gql`{ bdBranches { id } }`)).rejects.toThrow(/authorized|forbidden/i);
        await expect(
            staff.query(SAVE_BRANCH, { id: null, input: branchInput('Nope') }),
        ).rejects.toThrow(/authorized|forbidden/i);
    });

    it('adds branch tables without rewriting stock', () => {
        const dir = path.join(__dirname, '../../src/migrations');
        const file = readdirSync(dir).find(name => name.includes('bd-branches'));
        expect(file, 'migration bd-branches').toBeTruthy();
        const sqlText = readFileSync(path.join(dir, file!), 'utf8');
        expect(sqlText).not.toMatch(/UPDATE\s+stock_level/i);
        expect(sqlText).not.toMatch(/DELETE\s+FROM\s+stock_level/i);
        expect(sqlText).toMatch(/bd_stock_transfer/);
        expect(sqlText).toMatch(/bd_stock_transfer_number_seq/);
    });
});

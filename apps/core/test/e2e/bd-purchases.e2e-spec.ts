import { TransactionalConnection } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMigrationOnlyObjects, createTestConfig, testInitialData, testProductsCsvPath } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3092;
const config = createTestConfig(PORT);
const { server, adminClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;
const tk = (taka: number) => taka * 100;

const SAVE_SUPPLIER = gql`
    mutation ($input: JSON!) {
        createBdSupplier(input: $input) {
            errors { path code }
            supplier { id name phone balance }
        }
    }
`;
const SAVE_PURCHASE = gql`
    mutation ($input: JSON!) {
        createBdPurchase(input: $input) {
            errors { path }
            purchase { id number status owed total lines { id variantId quantity unitCost } }
        }
    }
`;
const ORDERED = gql`
    mutation ($id: ID!) {
        markBdPurchaseOrdered(id: $id) { id status owed }
    }
`;
const RECEIVE = gql`
    mutation ($id: ID!, $input: JSON!) {
        receiveBdPurchase(id: $id, input: $input) { id status owed lines { id received } }
    }
`;
const RETURN = gql`
    mutation ($id: ID!, $input: JSON!) {
        returnBdPurchase(id: $id, input: $input) { id lines { id returned } }
    }
`;
const PAY = gql`
    mutation ($input: JSON!) {
        recordBdSupplierPayment(input: $input) { id balance }
    }
`;

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

async function variant(sku: string) {
    const { productVariants } = await adminClient.query(
        gql`
            query ($sku: String!) {
                productVariants(options: { filter: { sku: { eq: $sku } } }) {
                    items { id productId stockOnHand customFields { unitCost } }
                }
            }
        `,
        { sku },
    );
    return productVariants.items[0] as {
        id: string;
        productId: string;
        stockOnHand: number;
        customFields: { unitCost: number | null };
    };
}

async function supplier(name: string) {
    const saved = await adminClient.query(SAVE_SUPPLIER, {
        input: { name, phone: '01711100000', address: 'Mirpur', note: '' },
    });
    expect(saved.createBdSupplier.errors).toEqual([]);
    return saved.createBdSupplier.supplier as { id: string; balance: number };
}

async function draft(supplierId: string, variantId: string, quantity: number, unitCost: number, extra: Record<string, unknown> = {}) {
    const saved = await adminClient.query(SAVE_PURCHASE, {
        input: {
            supplierId,
            purchasedOn: '2026-11-16',
            note: '',
            delivery: 0,
            other: 0,
            discount: 0,
            paid: 0,
            lines: [{ id: null, variantId, quantity, unitCost }],
            ...extra,
        },
    });
    expect(saved.createBdPurchase.errors).toEqual([]);
    return saved.createBdPurchase.purchase as {
        id: string;
        number: string;
        status: string;
        owed: number;
        lines: Array<{ id: string }>;
    };
}

async function orderAndReceive(purchaseId: string, lineId: string, quantity: number, note = '') {
    await adminClient.query(ORDERED, { id: purchaseId });
    return adminClient.query(RECEIVE, { id: purchaseId, input: { note, lines: [{ lineId, quantity }] } });
}

describe('receiving stock and cost', () => {
    it('raises stock and cost, and a return reverses both', async () => {
        const cloth = await variant('PANJABI-1');
        await adminClient.query(gql`
            mutation ($id: ID!) {
                updateProductVariants(input: [{ id: $id, stockOnHand: 0, customFields: { unitCost: null } }]) { id }
            }
        `, { id: cloth.id });
        const shop = await supplier('করিম ট্রেডার্স');
        const first = await draft(shop.id, cloth.id, 4, tk(250));
        const received = await orderAndReceive(first.id, first.lines[0]!.id, 4);
        expect(received.receiveBdPurchase.status).toBe('received');
        let now = await variant('PANJABI-1');
        expect(now.stockOnHand).toBe(4);
        expect(now.customFields.unitCost).toBe(tk(250));

        const second = await draft(shop.id, cloth.id, 4, tk(350));
        await orderAndReceive(second.id, second.lines[0]!.id, 4);
        now = await variant('PANJABI-1');
        expect(now.stockOnHand).toBe(8);
        expect(now.customFields.unitCost).toBe(tk(300));

        const returned = await adminClient.query(RETURN, {
            id: second.id,
            input: { note: '', lines: [{ lineId: second.lines[0]!.id, quantity: 4 }] },
        });
        expect(returned.returnBdPurchase.lines[0].returned).toBe(4);
        now = await variant('PANJABI-1');
        expect(now.stockOnHand).toBe(4);
        expect(now.customFields.unitCost).toBe(tk(250));

        const { bdStockHistory } = await adminClient.query(gql`
            query ($id: ID!) { bdStockHistory(variantId: $id) { reason change } }
        `, { id: cloth.id });
        const reasons = (bdStockHistory as Array<{ reason: string; change: number }>).map(row => row.reason);
        expect(reasons).toContain('purchase');
        expect(reasons).toContain('purchaseReturn');
    });

    it('uses the latest cost when the store says so, and a full return puts the old cost back', async () => {
        await adminClient.query(gql`
            mutation ($input: JSON!) {
                updateBdPurchaseSettings(input: $input)
            }
        `, { input: { purchasePrefix: 'PO', returnPrefix: 'PR', costMethod: 'latest' } });
        const saree = await variant('SAREE-1');
        await adminClient.query(gql`
            mutation ($id: ID!, $cost: Int) {
                updateProductVariants(input: [{ id: $id, customFields: { unitCost: $cost } }]) { id }
            }
        `, { id: saree.id, cost: tk(80) });
        const before = (await variant('SAREE-1')).stockOnHand;
        const shop = await supplier('লেটেস্ট সাপ্লায়ার');
        const purchase = await draft(shop.id, saree.id, 1, tk(900));
        await orderAndReceive(purchase.id, purchase.lines[0]!.id, 1);
        expect((await variant('SAREE-1')).customFields.unitCost).toBe(tk(900));
        await adminClient.query(RETURN, {
            id: purchase.id,
            input: { lines: [{ lineId: purchase.lines[0]!.id, quantity: 1 }] },
        });
        const after = await variant('SAREE-1');
        expect(after.stockOnHand).toBe(before);
        expect(after.customFields.unitCost).toBe(tk(80));
        await adminClient.query(gql`
            mutation ($input: JSON!) {
                updateBdPurchaseSettings(input: $input)
            }
        `, { input: { purchasePrefix: 'PO', returnPrefix: 'PR', costMethod: 'average' } });
    });

    it('keeps the supplier balance equal to purchases, returns and payments', async () => {
        const cloth = await variant('PANJABI-1');
        const shop = await supplier('ব্যালেন্স সাপ্লায়ার');
        const purchase = await draft(shop.id, cloth.id, 10, tk(100), { delivery: tk(50), paid: tk(200) });
        const ordered = await adminClient.query(ORDERED, { id: purchase.id });
        expect(ordered.markBdPurchaseOrdered.owed).toBe(-tk(200));
        const { bdSupplier: ahead } = await adminClient.query(gql`
            query ($id: ID!) { bdSupplier(id: $id) { balance } }
        `, { id: shop.id });
        expect(ahead.balance).toBe(-tk(200));

        const received = await adminClient.query(RECEIVE, {
            id: purchase.id,
            input: { lines: [{ lineId: purchase.lines[0]!.id, quantity: 10 }] },
        });
        expect(received.receiveBdPurchase.owed).toBe(tk(100) * 10 + tk(50) - tk(200));
        await adminClient.query(RETURN, {
            id: purchase.id,
            input: { lines: [{ lineId: purchase.lines[0]!.id, quantity: 2 }] },
        });
        const paid = await adminClient.query(PAY, {
            input: { supplierId: shop.id, amount: tk(150), paidOn: '2026-11-16', note: 'বিকাশ' },
        });
        expect(paid.recordBdSupplierPayment.balance).toBe(tk(100) * 10 + tk(50) - tk(200) - tk(100) * 2 - tk(150));
    });
});

describe('edge cases', () => {
    it('allows receiving more than was ordered, once a note is written', async () => {
        const cloth = await variant('PANJABI-1');
        const before = (await variant('PANJABI-1')).stockOnHand;
        const shop = await supplier('অতিরিক্ত মাল');
        const purchase = await draft(shop.id, cloth.id, 2, tk(10));
        await adminClient.query(ORDERED, { id: purchase.id });
        await expect(
            adminClient.query(RECEIVE, {
                id: purchase.id,
                input: { note: '', lines: [{ lineId: purchase.lines[0]!.id, quantity: 3 }] },
            }),
        ).rejects.toThrow(/note|নোট|ordered/i);
        const received = await adminClient.query(RECEIVE, {
            id: purchase.id,
            input: { note: 'এক বাক্স বেশি', lines: [{ lineId: purchase.lines[0]!.id, quantity: 3 }] },
        });
        expect(received.receiveBdPurchase.status).toBe('received');
        expect(received.receiveBdPurchase.lines[0].received).toBe(3);
        expect((await variant('PANJABI-1')).stockOnHand).toBe(before + 3);
    });

    it('receives into a hidden product and an archived one', async () => {
        const hidden = await variant('PANJABI-1');
        await adminClient.query(gql`
            mutation ($id: ID!) { updateProduct(input: { id: $id, enabled: false }) { enabled } }
        `, { id: hidden.productId });
        const beforeHidden = (await variant('PANJABI-1')).stockOnHand;
        const shop = await supplier('লুকানো পণ্য');
        const purchase = await draft(shop.id, hidden.id, 1, tk(10));
        await orderAndReceive(purchase.id, purchase.lines[0]!.id, 1);
        expect((await variant('PANJABI-1')).stockOnHand).toBe(beforeHidden + 1);
        await adminClient.query(gql`
            mutation ($id: ID!) { updateProduct(input: { id: $id, enabled: true }) { id } }
        `, { id: hidden.productId });

        const { createProduct } = await adminClient.query(gql`
            mutation {
                createProduct(input: { translations: [{ languageCode: en, name: "Archived cloth", slug: "archived-cloth", description: "" }] }) { id }
            }
        `);
        const { createProductVariants } = await adminClient.query(gql`
            mutation ($productId: ID!) {
                createProductVariants(input: [{
                    productId: $productId, sku: "ARCHIVED-1", price: 100000, stockOnHand: 0,
                    translations: [{ languageCode: en, name: "Archived cloth" }]
                }]) { id }
            }
        `, { productId: createProduct.id });
        const variantId = createProductVariants[0].id as string;
        await adminClient.query(gql`
            mutation ($id: ID!) { deleteProduct(id: $id) { result } }
        `, { id: createProduct.id });
        const archived = await draft(shop.id, variantId, 2, tk(15));
        await orderAndReceive(archived.id, archived.lines[0]!.id, 2);
        const { productVariants } = await adminClient.query(gql`
            query { productVariants(options: { filter: { sku: { eq: "ARCHIVED-1" } } }) { items { stockOnHand } } }
        `);
        expect(productVariants.items[0]?.stockOnHand).toBeUndefined();
        const rows = (await server.app.get(TransactionalConnection).rawConnection.query(
            `SELECT "stockOnHand" FROM stock_level WHERE "productVariantId" = $1`,
            [String(variantId).replace(/^T_/, '')],
        )) as Array<{ stockOnHand: number }>;
        expect(rows[0]?.stockOnHand).toBe(2);
    });

    it('refuses to delete a purchase once stock has been received', async () => {
        const cloth = await variant('SAREE-1');
        const shop = await supplier('মুছে ফেলা');
        const open = await draft(shop.id, cloth.id, 1, tk(10));
        const removed = await adminClient.query(gql`
            mutation ($id: ID!) { deleteBdPurchase(id: $id) }
        `, { id: open.id });
        expect(removed.deleteBdPurchase).toBe(true);

        const kept = await draft(shop.id, cloth.id, 1, tk(10));
        await orderAndReceive(kept.id, kept.lines[0]!.id, 1);
        await expect(
            adminClient.query(gql`mutation ($id: ID!) { deleteBdPurchase(id: $id) }`, { id: kept.id }),
        ).rejects.toThrow(/Return|ফেরত/i);
    });
});

describe('who can see a purchase', () => {
    it('gives purchase permissions to the owner and the manager only', async () => {
        const { roles } = await adminClient.query(gql`
            { roles(options: { take: 20 }) { items { code permissions } } }
        `);
        const of = (code: string) =>
            roles.items.find((role: { code: string }) => role.code === code).permissions as string[];
        for (const code of ['owner', 'manager']) {
            expect(of(code)).toContain('ReadPurchase');
            expect(of(code)).toContain('ManagePurchase');
        }
        for (const code of ['order-staff', 'packer', 'marketing']) {
            expect(of(code)).not.toContain('ReadPurchase');
            expect(of(code)).not.toContain('ManagePurchase');
        }
    });

    it('refuses suppliers, purchases and the print to order staff', async () => {
        const shop = await supplier('গোপন');
        const purchase = await draft(shop.id, (await variant('SAREE-1')).id, 1, tk(123));
        const staff = await staffClient('orders.purchase@example.com', 'order-staff');
        await expect(staff.query(gql`{ bdSuppliers { totalItems } }`)).rejects.toThrow(/authorized/i);
        await expect(staff.query(gql`query ($id: ID!) { bdPurchase(id: $id) { id } }`, { id: purchase.id })).rejects.toThrow(
            /authorized/i,
        );
        await expect(
            staff.query(gql`query ($id: ID!) { bdPurchasePrint(id: $id, document: "order") }`, { id: purchase.id }),
        ).rejects.toThrow(/authorized/i);
        const printed = await adminClient.query(gql`
            query ($id: ID!) { bdPurchasePrint(id: $id, document: "order") }
        `, { id: purchase.id });
        expect(JSON.stringify(printed)).toContain(String(tk(123)));
    });
});

async function staffClient(email: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        { roles(options: { take: 20 }) { items { id code } } }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
    await adminClient.query(gql`
        mutation ($input: CreateAdministratorInput!) {
            createAdministrator(input: $input) { id }
        }
    `, {
        input: {
            firstName: 'Staff',
            lastName: 'Purchase',
            emailAddress: email,
            password: 'staff-password-123',
            roleIds: [role.id],
        },
    });
    const client = new SimpleGraphQLClient(config, adminUrl);
    await client.asUserWithCredentials(email, 'staff-password-123');
    return client;
}

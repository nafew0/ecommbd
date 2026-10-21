import { emptyProductForm, emptyVariant, type ProductForm, takaToMinor } from '@ecommbd/shared';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3061;
const config = createTestConfig(PORT);
const { server, adminClient } = createTestEnvironment(config);

const tk = takaToMinor;

const SAVE = gql`
    mutation ($input: JSON!) {
        saveBdProduct(input: $input) {
            product
            errors {
                path
                code
            }
        }
    }
`;

const FORM = gql`
    query ($id: ID!) {
        bdProductForm(id: $id)
    }
`;

const PRODUCTS = gql`
    query ($search: String) {
        bdProducts(search: $search) {
            totalItems
            items {
                id
                name
                banglaMissing
                categoryName
                price
                oldPrice
                stock
                variantCount
                featured
                isNew
            }
        }
    }
`;

const SAVE_CATEGORY = gql`
    mutation ($input: BdSaveCategoryInput!) {
        saveBdCategory(input: $input) {
            id
            name {
                bn
                en
            }
            productCount
            freeDelivery
        }
    }
`;

const STOCK = gql`
    query ($search: String) {
        bdStock(search: $search) {
            variantId
            name
            sku
            stockOnHand
            available
            backorder
            low
        }
    }
`;

const ADJUST = gql`
    mutation ($input: BdAdjustStockInput!) {
        adjustBdStock(input: $input) {
            change
            stockAfter
            reason
            note
            staffName
        }
    }
`;

const HISTORY = gql`
    query ($variantId: ID!) {
        bdStockHistory(variantId: $variantId) {
            change
            stockAfter
            reason
        }
    }
`;

const COLLECTION_PRODUCTS = gql`
    query ($id: ID!) {
        collection(id: $id) {
            productVariants {
                totalItems
            }
        }
    }
`;

const panjabi = (categoryId: string | null): ProductForm => ({
    ...emptyProductForm(),
    name: { bn: 'সুতি পাঞ্জাবি', en: 'Cotton Panjabi' },
    shortDescription: { bn: 'আরামদায়ক ঈদের পাঞ্জাবি', en: 'A comfortable Eid panjabi' },
    featured: true,
    isNew: true,
    youtubeUrl: 'youtu.be/abc123',
    categoryId,
    delivery: { free: false, insideDhaka: tk(80), outsideDhaka: null, surcharge: 0 },
    variationType: 'size',
    variants: (['M', 'L', 'XL'] as const).map((size, index) => ({
        ...emptyVariant(),
        option: { bn: size, en: size },
        price: tk(1250 + index * 50),
        oldPrice: tk(1500),
        stock: 10 + index,
        isDefault: size === 'L',
        weightGrams: 400,
    })),
});

async function save(input: ProductForm) {
    const { saveBdProduct } = await adminClient.query(SAVE, { input });
    return saveBdProduct as { product: ProductForm | null; errors: Array<{ path: string; code: string }> };
}

let categoryId: string;
let productId: string;

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 0 });
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('categories', () => {
    it('creates a category with names in both languages, and free delivery', async () => {
        const { saveBdCategory } = await adminClient.query(SAVE_CATEGORY, {
            input: { name: { bn: ' পাঞ্জাবি ', en: 'Panjabi' }, freeDelivery: true },
        });
        expect(saveBdCategory).toMatchObject({ name: { bn: 'পাঞ্জাবি', en: 'Panjabi' }, freeDelivery: true });
        categoryId = saveBdCategory.id;
        const { bdShippingSettings } = await adminClient.query(gql`
            {
                bdShippingSettings
            }
        `);
        // Only the list changed: the charges are still the unconfirmed suggestions.
        expect(bdShippingSettings).toMatchObject({
            freeCollectionIds: [String(categoryId).replace('T_', '')],
            confirmed: false,
        });
    });

    it('needs a name', async () => {
        await expect(
            adminClient.query(SAVE_CATEGORY, { input: { name: { bn: '', en: ' ' } } }),
        ).rejects.toThrow(/Give the category a name/);
    });
});

describe('the product form', () => {
    it('saves a product with three sizes on one form, and loads it back', async () => {
        const result = await save(panjabi(categoryId));
        expect(result.errors).toEqual([]);
        const product = result.product!;
        productId = product.id!;
        expect(product).toMatchObject({
            name: { bn: 'সুতি পাঞ্জাবি', en: 'Cotton Panjabi' },
            shortDescription: { bn: 'আরামদায়ক ঈদের পাঞ্জাবি', en: 'A comfortable Eid panjabi' },
            featured: true,
            isNew: true,
            youtubeUrl: 'https://youtu.be/abc123',
            categoryId,
            delivery: { insideDhaka: tk(80), outsideDhaka: null },
            variationType: 'size',
        });
        expect(
            product.variants.map(v => [v.option.en, v.price, v.stock, v.isDefault, v.weightGrams]),
        ).toEqual([
            ['M', tk(1250), 10, false, 400],
            ['L', tk(1300), 11, true, 400],
            ['XL', tk(1350), 12, false, 400],
        ]);
        const { bdProductForm } = await adminClient.query(FORM, { id: productId });
        expect(bdProductForm).toEqual(product);
    });

    it('shows it in the list with price, old price, stock and badges', async () => {
        const { bdProducts } = await adminClient.query(PRODUCTS, { search: 'panjabi' });
        expect(bdProducts.items).toEqual([
            {
                id: productId,
                name: 'সুতি পাঞ্জাবি',
                banglaMissing: false,
                categoryName: 'পাঞ্জাবি',
                price: tk(1250),
                oldPrice: tk(1500),
                stock: 33,
                variantCount: 3,
                featured: true,
                isNew: true,
            },
        ]);
    });

    it('fills the category', async () => {
        for (let i = 0; i < 50; i += 1) {
            const { collection } = await adminClient.query(COLLECTION_PRODUCTS, { id: categoryId });
            if (collection.productVariants.totalItems === 3) return;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('The category never got its products');
    });

    it('edits: a removed size goes, a price changes, a stock change is a recount', async () => {
        const { bdProductForm } = await adminClient.query(FORM, { id: productId });
        const form = bdProductForm as ProductForm;
        const [m, l] = form.variants;
        const result = await save({ ...form, variants: [{ ...m!, price: tk(1200), stock: 7 }, l!] });
        expect(result.errors).toEqual([]);
        expect(result.product!.variants.map(v => [v.option.en, v.price, v.stock])).toEqual([
            ['M', tk(1200), 7],
            ['L', tk(1300), 11],
        ]);
        const { bdStockHistory } = await adminClient.query(HISTORY, { variantId: m!.id });
        expect(bdStockHistory).toEqual([{ change: -3, stockAfter: 7, reason: 'recount' }]);
    });

    it('changes the kind of variation (sizes → colours)', async () => {
        const { bdProductForm } = await adminClient.query(FORM, { id: productId });
        const form = bdProductForm as ProductForm;
        const result = await save({
            ...form,
            variationType: 'colour',
            variants: [
                {
                    ...emptyVariant(),
                    option: { bn: 'সাদা', en: 'White' },
                    price: tk(1300),
                    stock: 5,
                    isDefault: true,
                },
                { ...emptyVariant(), option: { bn: 'নীল', en: '' }, price: tk(1300), stock: 4 },
            ],
        });
        expect(result.errors).toEqual([]);
        expect(result.product!.variants.map(v => v.option)).toEqual([
            { bn: 'সাদা', en: 'White' },
            { bn: 'নীল', en: '' },
        ]);
    });

    it('marks a product without a Bangla name', async () => {
        const english = await save({
            ...emptyProductForm(),
            name: { bn: '', en: 'Silk Saree' },
            variants: [{ ...emptyVariant(), price: tk(4500), stock: 2, isDefault: true }],
        });
        expect(english.errors).toEqual([]);
        const { bdProducts } = await adminClient.query(PRODUCTS, { search: 'saree' });
        expect(bdProducts.items[0]).toMatchObject({
            name: 'Silk Saree',
            banglaMissing: true,
            variantCount: 1,
        });
    });

    it('returns field errors', async () => {
        const bad = panjabi('999999');
        expect((await save({ ...bad, name: { bn: '', en: '' } })).errors).toContainEqual({
            path: 'name.bn',
            code: 'required',
        });
        expect((await save(bad)).errors).toEqual([{ path: 'categoryId', code: 'notFound' }]);
    });
});

describe('stock', () => {
    it('adjusts with a reason and lists low stock first', async () => {
        const { bdStock } = await adminClient.query(STOCK, { search: 'saree' });
        const saree = bdStock[0];
        expect(saree).toMatchObject({ stockOnHand: 2, available: 2, low: true, backorder: false });
        const { adjustBdStock } = await adminClient.query(ADJUST, {
            input: { variantId: saree.variantId, change: 20, reason: 'received', note: 'New shipment' },
        });
        expect(adjustBdStock).toMatchObject({
            change: 20,
            stockAfter: 22,
            reason: 'received',
            note: 'New shipment',
        });
        await expect(
            adminClient.query(ADJUST, {
                input: { variantId: saree.variantId, change: -100, reason: 'damaged' },
            }),
        ).rejects.toThrow(/below zero/);
        await expect(
            adminClient.query(ADJUST, { input: { variantId: saree.variantId, change: 1, reason: 'magic' } }),
        ).rejects.toThrow(/Choose why/);
        const after = (await adminClient.query(STOCK, { search: 'saree' })).bdStock[0];
        expect(after).toMatchObject({ stockOnHand: 22, low: false });
    });
});

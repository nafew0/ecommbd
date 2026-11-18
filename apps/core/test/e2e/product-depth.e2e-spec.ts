import { emptyProductForm, emptyVariant, type ProductForm, takaToMinor } from '@ecommbd/shared';
import { DefaultSearchPlugin, RequestContextService } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductStatusService } from '../../src/plugins/bd-catalog';
import { DHAKA, MIRPUR, prepareCheckout } from '../support/checkout';
import { addMigrationOnlyObjects, createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

/**
 * Product depth (roadmap phase 55): status and trash, units, brands, shipping classes,
 * dimensions and the SKU prefix, with products made on the product form. A product saved
 * before phase 55 must load and save exactly as before.
 */

const PORT = 3097;
const config = createTestConfig(PORT, {}, { searchCatalogCacheMs: 0 });
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }));
const { server, adminClient, shopClient } = createTestEnvironment(config);

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
const LIST = gql`
    query ($status: String, $search: String) {
        bdProducts(status: $status, search: $search) {
            totalItems
            items {
                id
                name
                enabled
                status
                trashExpiresAt
            }
        }
    }
`;
const SETTINGS = gql`
    query {
        bdProductSettings
    }
`;
const UPDATE_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdProductSettings(input: $input) {
            settings
            errors {
                path
                code
            }
        }
    }
`;
const TRASH = gql`
    mutation ($id: ID!) {
        trashBdProduct(id: $id)
    }
`;
const RESTORE = gql`
    mutation ($id: ID!) {
        restoreBdProduct(id: $id)
    }
`;
const DELETE_FOREVER = gql`
    mutation ($id: ID!) {
        deleteBdProductForever(id: $id)
    }
`;
const SAVE_BRAND = gql`
    mutation ($input: JSON!) {
        saveBdBrand(input: $input) {
            brand {
                id
                code
                name {
                    bn
                    en
                }
                description {
                    bn
                    en
                }
                productCount
            }
            errors {
                path
                code
            }
        }
    }
`;
const BRANDS = gql`
    query {
        bdBrands {
            id
            code
            productCount
        }
    }
`;
const DELETE_BRAND = gql`
    mutation ($id: ID!) {
        deleteBdBrand(id: $id)
    }
`;
const SHOP_PRODUCT = gql`
    query ($slug: String!) {
        product(slug: $slug) {
            id
            bdUnit
            facetValues {
                code
                name
                facet {
                    code
                }
            }
        }
    }
`;
const SHOP_BRAND = gql`
    query ($code: String!) {
        bdBrand(code: $code) {
            code
            name
            description
        }
    }
`;
const SHOP_BRANDS = gql`
    query {
        bdBrands {
            code
        }
    }
`;
const SEARCH = gql`
    query ($input: BdSearchInput!) {
        bdSearch(input: $input) {
            totalItems
            productIds
            filters {
                key
                kind
                label
                values {
                    value
                    label
                    count
                }
            }
        }
    }
`;
const ELIGIBLE = gql`
    query {
        eligibleShippingMethods {
            code
            priceWithTax
            metadata
        }
    }
`;

type Form = ProductForm & { id: string };
type SaveResult = { product: Form | null; errors: Array<{ path: string; code: string }> };

async function save(input: unknown): Promise<SaveResult> {
    return (await adminClient.query(SAVE, { input })).saveBdProduct;
}

async function load(id: string): Promise<Form | null> {
    return (await adminClient.query(FORM, { id })).bdProductForm;
}

async function list(status: string | null, search?: string) {
    const { bdProducts } = await adminClient.query(LIST, { status, search: search ?? null });
    return bdProducts as {
        totalItems: number;
        items: Array<{ id: string; name: string; enabled: boolean; status: string; trashExpiresAt: string | null }>;
    };
}

async function settings(input: unknown) {
    const { updateBdProductSettings } = await adminClient.query(UPDATE_SETTINGS, { input });
    return updateBdProductSettings as { settings: unknown; errors: Array<{ path: string; code: string }> };
}

const product = (name: string, patch: Partial<ProductForm> = {}): ProductForm => ({
    ...emptyProductForm(),
    name: { bn: name, en: name },
    variants: [{ ...emptyVariant(), price: tk(500), stock: 5, isDefault: true }],
    ...patch,
});

async function created(name: string, patch: Partial<ProductForm> = {}): Promise<Form> {
    const result = await save(product(name, patch));
    expect(result.errors).toEqual([]);
    return result.product!;
}

/** Waits for the worker: the search index is filled by a job (as in bd-search.e2e-spec.ts). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 15_000): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (done(value) || Date.now() - started > ms) return value;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 1 });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('a product saved before phase 55', () => {
    it('loads and saves as before: published, no brand, unit, class or size, and the P SKU', async () => {
        // The form exactly as the admin sent it before phase 55: none of the new keys.
        const old = product('Old Panjabi') as Partial<ProductForm>;
        for (const key of ['status', 'brandId', 'unit', 'shippingClass'] as const) delete old[key];
        old.variants = old.variants!.map(variant => {
            const { lengthCm, widthCm, heightCm, ...rest } = variant;
            void lengthCm;
            void widthCm;
            void heightCm;
            return rest as never;
        });
        const saved = await save(old);
        expect(saved.errors).toEqual([]);
        const form = saved.product!;
        expect(form).toMatchObject({
            enabled: true,
            status: 'published',
            brandId: null,
            unit: null,
            shippingClass: null,
        });
        expect(form.variants[0]).toMatchObject({ lengthCm: null, widthCm: null, heightCm: null });
        const raw = String(form.id).replace(/^T_/, '');
        expect(form.variants[0]!.sku).toBe(`P${raw}-1`);

        const again = await save(form);
        expect(again.errors).toEqual([]);
        expect(again.product).toEqual(form);
    });

    it('keeps a hidden product as a draft', async () => {
        const hidden = await created('Old Hidden', { enabled: false, status: undefined });
        expect(hidden.status).toBe('draft');
        expect(hidden.enabled).toBe(false);
    });
});

describe('product settings', () => {
    it('starts with the P prefix, no own units and no shipping classes', async () => {
        const { bdProductSettings } = await adminClient.query(SETTINGS);
        expect(bdProductSettings).toEqual({ skuPrefix: 'P', customUnits: [], shippingClasses: [] });
    });

    it('saves units, classes and the prefix, and returns field errors', async () => {
        const bad = await settings({ skuPrefix: '', customUnits: [{ name: { bn: '', en: '' } }], shippingClasses: [] });
        expect(bad.errors.map(error => error.path).sort()).toEqual(['customUnits.0.name.bn', 'skuPrefix']);
        const good = await settings({
            skuPrefix: 'mb',
            customUnits: [{ name: { bn: 'হালি', en: 'Hali' } }],
            shippingClasses: [{ name: { bn: 'বড় বাক্স', en: 'Bulky' }, charge: tk(100) }],
        });
        expect(good.errors).toEqual([]);
        expect(good.settings).toEqual({
            skuPrefix: 'MB',
            customUnits: [{ code: 'hali', name: { bn: 'হালি', en: 'Hali' } }],
            shippingClasses: [{ code: 'bulky', name: { bn: 'বড় বাক্স', en: 'Bulky' }, charge: tk(100) }],
        });
    });

    it('uses the prefix for an empty SKU, and leaves a typed SKU alone', async () => {
        const result = await created('Prefix Shirt', {
            variationType: 'size',
            variants: [
                { ...emptyVariant(), option: { bn: 'M', en: 'M' }, price: tk(300), stock: 1, isDefault: true },
                { ...emptyVariant(), option: { bn: 'L', en: 'L' }, sku: 'MY-OWN', price: tk(300), stock: 1 },
            ],
        });
        const raw = String(result.id).replace(/^T_/, '');
        expect(result.variants.map(variant => variant.sku)).toEqual([`MB${raw}-1`, 'MY-OWN']);
    });
});

describe('status and trash', () => {
    let draftId: string;
    let archivedId: string;
    let liveId: string;

    it('saves published, draft and archived, and lists each under its own tab', async () => {
        liveId = (await created('Live Lungi', { status: 'published' })).id;
        draftId = (await created('Draft Lungi', { status: 'draft' })).id;
        const archived = await created('Archived Lungi', { status: 'archived' });
        archivedId = archived.id;
        expect(archived).toMatchObject({ status: 'archived', enabled: false });

        const names = async (status: string | null) =>
            (await list(status, 'Lungi')).items.map(item => `${item.name}:${item.status}`).sort();
        expect(await names(null)).toEqual([
            'Archived Lungi:archived',
            'Draft Lungi:draft',
            'Live Lungi:published',
        ]);
        expect(await names('published')).toEqual(['Live Lungi:published']);
        expect(await names('draft')).toEqual(['Draft Lungi:draft']);
        expect(await names('archived')).toEqual(['Archived Lungi:archived']);
    });

    it('shows only published products in the shop', async () => {
        await shopClient.asAnonymousUser();
        const shop = async (name: string) => (await shopClient.query(SHOP_PRODUCT, { slug: slugOf(name) })).product;
        expect(await shop('Live Lungi')).not.toBeNull();
        expect(await shop('Draft Lungi')).toBeNull();
        expect(await shop('Archived Lungi')).toBeNull();
    });

    it('moves a product to the trash: off the store and the list, not editable, back as a draft', async () => {
        expect((await adminClient.query(TRASH, { id: liveId })).trashBdProduct).toBe(true);
        expect((await list(null, 'Live Lungi')).totalItems).toBe(0);
        const trash = await list('trash', 'Live Lungi');
        expect(trash.items).toHaveLength(1);
        expect(trash.items[0]).toMatchObject({ status: 'trash', enabled: false });
        const left = new Date(trash.items[0]!.trashExpiresAt!).getTime() - Date.now();
        expect(left).toBeGreaterThan(29 * 24 * 3600_000);
        expect(left).toBeLessThanOrEqual(30 * 24 * 3600_000);

        await shopClient.asAnonymousUser();
        expect((await shopClient.query(SHOP_PRODUCT, { slug: 'live-lungi' })).product).toBeNull();
        expect(await load(liveId)).toBeNull();
        const refused = await save(product('Live Lungi', { id: liveId }));
        expect(refused.errors).toEqual([{ path: 'id', code: 'notFound' }]);

        await adminClient.query(RESTORE, { id: liveId });
        const back = await load(liveId);
        expect(back).toMatchObject({ status: 'draft', enabled: false });
    });

    it('deletes for good only from the trash', async () => {
        await expect(adminClient.query(DELETE_FOREVER, { id: draftId })).rejects.toThrow(
            /trash/i,
        );
        await adminClient.query(TRASH, { id: draftId });
        expect((await adminClient.query(DELETE_FOREVER, { id: draftId })).deleteBdProductForever).toBe(true);
        expect((await list('trash', 'Draft Lungi')).totalItems).toBe(0);
        expect(await load(draftId)).toBeNull();
    });

    it('empties products that have been in the trash for 30 days', async () => {
        await adminClient.query(TRASH, { id: archivedId });
        const statuses = server.app.get(ProductStatusService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        expect(await statuses.emptyOld(ctx, new Date(Date.now() + 29 * 24 * 3600_000))).toBe(0);
        expect(await statuses.emptyOld(ctx, new Date(Date.now() + 31 * 24 * 3600_000))).toBe(1);
        expect((await list('trash', 'Archived Lungi')).totalItems).toBe(0);
    });

    it('refuses the trash to a role without delete permission', async () => {
        const target = await created('Guarded Lungi');
        const { createAdministrator } = await adminClient.query(
            gql`
                mutation ($roleId: ID!) {
                    createAdministrator(
                        input: {
                            firstName: "Order"
                            lastName: "Staff"
                            emailAddress: "staff-p55@example.com"
                            password: "test-staff-p55"
                            roleIds: [$roleId]
                        }
                    ) {
                        id
                    }
                }
            `,
            {
                roleId: (
                    await adminClient.query(gql`
                        mutation {
                            createRole(
                                input: { code: "p55-reader", description: "Reader", permissions: [ReadCatalog, ReadProduct] }
                            ) {
                                id
                            }
                        }
                    `)
                ).createRole.id,
            },
        );
        expect(createAdministrator.id).toBeTruthy();
        await adminClient.asUserWithCredentials('staff-p55@example.com', 'test-staff-p55');
        try {
            await expect(adminClient.query(TRASH, { id: target.id })).rejects.toThrow(/not currently authorized/i);
            await expect(
                adminClient.query(UPDATE_SETTINGS, { input: { skuPrefix: 'X', customUnits: [], shippingClasses: [] } }),
            ).rejects.toThrow(/not currently authorized/i);
        } finally {
            await adminClient.asSuperAdmin();
        }
    });
});

describe('units and dimensions', () => {
    it('shows the unit in the shopper’s language, and refuses one that doesn’t exist', async () => {
        await created('Fresh Mango', { unit: 'kg' });
        await created('Duck Eggs', { unit: 'hali' });
        await shopClient.asAnonymousUser();
        const unit = async (slug: string, languageCode: 'bn' | 'en') =>
            (await shopClient.query(SHOP_PRODUCT, { slug }, { languageCode })).product.bdUnit;
        expect(await unit('fresh-mango', 'bn')).toBe('কেজি');
        expect(await unit('fresh-mango', 'en')).toBe('kg');
        expect(await unit('duck-eggs', 'bn')).toBe('হালি');
        expect(await unit('live-lungi', 'bn').catch(() => 'not on sale')).toBe('not on sale');

        const refused = await save(product('Bad Unit', { unit: 'barrel' }));
        expect(refused.errors).toEqual([{ path: 'unit', code: 'notFound' }]);
    });

    it('keeps length, width and height next to the weight', async () => {
        const box = await created('Gift Box', {
            variants: [
                { ...emptyVariant(), price: tk(800), stock: 2, isDefault: true, weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 },
            ],
        });
        expect(box.variants[0]).toMatchObject({ weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 });
        const bad = await save(
            product('Bad Box', { variants: [{ ...emptyVariant(), price: tk(800), stock: 2, isDefault: true, lengthCm: 0 }] }),
        );
        expect(bad.errors).toEqual([{ path: 'variants.0.lengthCm', code: 'invalid' }]);
    });
});

describe('brands', () => {
    let brandId: string;
    let productId: string;

    it('creates a brand with a Bangla and English name and a description', async () => {
        const { saveBdBrand } = await adminClient.query(SAVE_BRAND, {
            input: {
                name: { bn: 'আড়ং', en: 'Aarong' },
                description: { bn: 'দেশি কারুশিল্প', en: 'Local crafts' },
            },
        });
        expect(saveBdBrand.errors).toEqual([]);
        expect(saveBdBrand.brand).toMatchObject({ code: 'aarong', name: { bn: 'আড়ং', en: 'Aarong' }, productCount: 0 });
        brandId = saveBdBrand.brand.id;

        const taken = await adminClient.query(SAVE_BRAND, { input: { name: { bn: 'অন্য', en: 'Other' }, code: 'aarong' } });
        expect(taken.saveBdBrand.errors).toEqual([{ path: 'code', code: 'taken' }]);
        const nameless = await adminClient.query(SAVE_BRAND, { input: { name: { bn: '', en: '' } } });
        expect(nameless.saveBdBrand.errors).toEqual([{ path: 'name.bn', code: 'required' }]);
    });

    it('puts the brand on a product, counts it, and keeps its other facet values', async () => {
        const made = await created('Nakshi Kantha', { brandId });
        productId = made.id;
        expect(made.brandId).toBe(brandId);
        const { bdBrands } = await adminClient.query(BRANDS);
        expect(bdBrands.find((brand: { id: string }) => brand.id === brandId).productCount).toBe(1);
        const refused = await save(product('No Such Brand', { brandId: 'T_9999' }));
        expect(refused.errors).toEqual([{ path: 'brandId', code: 'notFound' }]);
    });

    it('gives the shop a brand page, a sitemap entry and a brand filter', async () => {
        await shopClient.asAnonymousUser();
        const { bdBrand } = await shopClient.query(SHOP_BRAND, { code: 'aarong' }, { languageCode: 'bn' });
        expect(bdBrand).toEqual({ code: 'aarong', name: 'আড়ং', description: 'দেশি কারুশিল্প' });
        expect((await shopClient.query(SHOP_BRAND, { code: 'nope' })).bdBrand).toBeNull();
        const { bdBrands } = await shopClient.query(SHOP_BRANDS);
        expect(bdBrands.map((brand: { code: string }) => brand.code)).toEqual(['aarong']);

        const { product: shopProduct } = await shopClient.query(SHOP_PRODUCT, { slug: 'nakshi-kantha' });
        expect(shopProduct.facetValues).toEqual([{ code: 'aarong', name: 'আড়ং', facet: { code: 'brand' } }]);

        const bdSearch = await until(
            async () =>
                (
                    await shopClient.query(SEARCH, {
                        input: { filters: [{ key: 'brand', values: ['aarong'] }] },
                    })
                ).bdSearch,
            result => result.productIds.length > 0,
        );
        expect(bdSearch.productIds).toEqual([productId]);
        const filter = bdSearch.filters.find((item: { key: string }) => item.key === 'brand');
        expect(filter).toMatchObject({ kind: 'facet', values: [{ value: 'aarong', count: 1 }] });
    });

    it('deletes a brand and leaves its products working with no brand', async () => {
        expect((await adminClient.query(DELETE_BRAND, { id: brandId })).deleteBdBrand).toBe(true);
        const form = await load(productId);
        expect(form?.brandId).toBeNull();
        const resaved = await save(form);
        expect(resaved.errors).toEqual([]);
        await shopClient.asAnonymousUser();
        const { product: shopProduct } = await shopClient.query(SHOP_PRODUCT, { slug: 'nakshi-kantha' });
        expect(shopProduct.facetValues).toEqual([]);
    });
});

describe('shipping classes', () => {
    it('adds the class charge once to the delivery charge', async () => {
        const plain = await created('Plain Bag', { variants: [{ ...emptyVariant(), price: tk(400), stock: 9, isDefault: true }] });
        const bulky = await created('Bulky Chair', {
            shippingClass: 'bulky',
            variants: [{ ...emptyVariant(), price: tk(4000), stock: 9, isDefault: true }],
        });
        const quote = async (variantId: string, quantity: number) => {
            await shopClient.asAnonymousUser();
            await prepareCheckout(shopClient, {
                phone: `0171234${Math.floor(1000 + Math.random() * 8999)}`,
                variantId,
                quantity,
                districtId: DHAKA,
                thanaId: MIRPUR,
            }).catch(() => undefined);
            const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE);
            return eligibleShippingMethods.find((method: { code: string }) => method.code === 'bd-standard');
        };
        const base = (await quote(plain.variants[0]!.id!, 1)).priceWithTax;
        const withClass = await quote(bulky.variants[0]!.id!, 3);
        expect(withClass.priceWithTax).toBe(base + tk(100));
        expect(withClass.metadata).toMatchObject({ classSurcharge: tk(100) });

        const refused = await save(product('No Class', { shippingClass: 'ship' }));
        expect(refused.errors).toEqual([{ path: 'shippingClass', code: 'notFound' }]);
    });
});

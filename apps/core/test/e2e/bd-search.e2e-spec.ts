import { emptyProductForm, emptyVariant, type ProductForm, takaToMinor } from '@ecommbd/shared';
import { DefaultSearchPlugin, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdSearchService } from '../../src/plugins/bd-search';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

/**
 * Catalog search and filters (roadmap phase 13) against a real Vendure, PostgreSQL and Redis:
 * products made with phase 05's product form, indexed by Vendure's DefaultSearchPlugin, found in
 * Bangla, English, with typos and synonyms; categories with subcategories; per-variation filters;
 * suggestions; synonyms and searches with no results in the Admin API; rate limits.
 */

const PORT = 3067;
const config = createTestConfig(
    PORT,
    {},
    { searchCatalogCacheMs: 0, searchRateLimits: { suggest: { limit: 15, windowMs: 60_000 } } },
);
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }));
const { server, adminClient, shopClient } = createTestEnvironment(config);

const tk = takaToMinor;

const SAVE_PRODUCT = gql`
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
const SAVE_CATEGORY = gql`
    mutation ($input: BdSaveCategoryInput!) {
        saveBdCategory(input: $input) {
            id
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
                    selected
                }
            }
            priceRange {
                min
                max
            }
            inStockCount
            didYouMean
        }
    }
`;
const SUGGEST = gql`
    query ($term: String!) {
        bdSearchSuggestions(term: $term) {
            productIds
            collections {
                id
                name
                slugs
            }
            didYouMean
        }
    }
`;
const MISSES = gql`
    query {
        bdSearchMisses {
            term
            count
        }
    }
`;
const SETTINGS = gql`
    query {
        bdSearchSettings
    }
`;
const UPDATE_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdSearchSettings(input: $input) {
            settings
            errors {
                path
                code
            }
        }
    }
`;

interface SearchResult {
    totalItems: number;
    productIds: string[];
    filters: Array<{
        key: string;
        kind: string;
        label: string;
        values: Array<{ value: string; label: string; count: number; selected: boolean }>;
    }>;
    priceRange: { min: number; max: number } | null;
    inStockCount: number;
    didYouMean: string | null;
}

async function search(
    input: Record<string, unknown>,
    languageCode: 'bn' | 'en' = 'bn',
): Promise<SearchResult> {
    const { bdSearch } = await shopClient.query(SEARCH, { input }, { languageCode });
    return bdSearch;
}

async function saveProduct(form: Partial<ProductForm>): Promise<string> {
    const { saveBdProduct } = await adminClient.query(SAVE_PRODUCT, {
        input: { ...emptyProductForm(), ...form },
    });
    expect(saveBdProduct.errors).toEqual([]);
    return saveBdProduct.product.id;
}

const sizes = (names: string[], price: number, stock: (size: string) => number) =>
    names.map((size, index) => ({
        ...emptyVariant(),
        option: { bn: size, en: size },
        price: tk(price + index * 50),
        stock: stock(size),
        isDefault: index === 0,
    }));

/** Waits for the worker: the search index and category contents are filled by jobs. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 15_000): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (done(value) || Date.now() - started > ms) return value;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
}

let men: string;
let panjabiCategory: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 0 });
    await adminClient.asSuperAdmin();
    men = (await adminClient.query(SAVE_CATEGORY, { input: { name: { bn: 'পুরুষ', en: 'Men' } } }))
        .saveBdCategory.id;
    panjabiCategory = (
        await adminClient.query(SAVE_CATEGORY, {
            input: { name: { bn: 'পাঞ্জাবি', en: 'Panjabi' }, parentId: men },
        })
    ).saveBdCategory.id;
    ids.cotton = await saveProduct({
        name: { bn: 'সুতির পাঞ্জাবি', en: 'Cotton Panjabi' },
        categoryId: panjabiCategory,
        variationType: 'size',
        // XL is sold out.
        variants: sizes(['M', 'L', 'XL'], 1250, size => (size === 'XL' ? 0 : 10)),
    });
    ids.silk = await saveProduct({
        name: { bn: 'সিল্ক পাঞ্জাবি', en: 'Silk Panjabi' },
        categoryId: panjabiCategory,
        featured: true,
        variationType: 'size',
        variants: sizes(['M', 'L', 'XL'], 2400, () => 5),
    });
    ids.shirt = await saveProduct({
        name: { bn: 'ফরমাল শার্ট', en: 'Formal Shirt' },
        categoryId: men,
        variationType: 'colour',
        variants: [
            {
                ...emptyVariant(),
                option: { bn: 'কালো', en: 'Black' },
                price: tk(990),
                stock: 4,
                isDefault: true,
            },
            { ...emptyVariant(), option: { bn: 'সাদা', en: 'White' }, price: tk(990), stock: 4 },
        ],
    });
    ids.saree = await saveProduct({
        name: { bn: 'জামদানি শাড়ি', en: 'Jamdani Saree' },
        variants: [{ ...emptyVariant(), price: tk(6500), stock: 0, isDefault: true }],
    });
    ids.kantha = await saveProduct({
        name: { bn: 'নকশি কাঁথা', en: '' },
        variants: [{ ...emptyVariant(), price: tk(3500), stock: 2, isDefault: true }],
    });
    ids.hidden = await saveProduct({
        name: { bn: 'লুকানো পাঞ্জাবি', en: 'Hidden Panjabi' },
        enabled: false,
        variants: [{ ...emptyVariant(), price: tk(100), stock: 2, isDefault: true }],
    });
    // A public "tag" facet: Eid on the cotton panjabi.
    const { createFacet } = await adminClient.query(
        gql`
            mutation ($input: CreateFacetInput!) {
                createFacet(input: $input) {
                    values {
                        id
                    }
                }
            }
        `,
        {
            input: {
                code: 'tag',
                isPrivate: false,
                translations: [
                    { languageCode: 'en', name: 'Tag' },
                    { languageCode: 'bn', name: 'ট্যাগ' },
                ],
                values: [
                    {
                        code: 'eid',
                        translations: [
                            { languageCode: 'en', name: 'Eid' },
                            { languageCode: 'bn', name: 'ঈদ' },
                        ],
                    },
                ],
            },
        },
    );
    await adminClient.query(
        gql`
            mutation ($input: UpdateProductInput!) {
                updateProduct(input: $input) {
                    id
                }
            }
        `,
        { input: { id: ids.cotton, facetValueIds: [createFacet.values[0].id] } },
    );
    // Five enabled products indexed, the categories filled, the tag on the cotton panjabi.
    const ready = await until(
        () =>
            Promise.all([
                search({ take: 48 }),
                search({ collectionId: men }),
                search({ filters: [{ key: 'tag', values: ['eid'] }] }),
            ]),
        ([all, inMen, tagged]) => all.totalItems === 5 && inMen.totalItems === 3 && tagged.totalItems === 1,
        60_000,
    );
    expect(ready.map(result => result.totalItems)).toEqual([5, 3, 1]);
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('finding products', () => {
    it('finds the panjabi as "পাঞ্জাবি", "panjabi" (synonym) and "punjabi" (typo), on both language sites', async () => {
        for (const languageCode of ['bn', 'en'] as const) {
            for (const term of ['পাঞ্জাবি', 'panjabi', 'punjabi', 'পাঞ্জাবী']) {
                const result = await search({ term }, languageCode);
                expect(result.productIds, `${term} (${languageCode})`).toEqual(
                    expect.arrayContaining([ids.cotton, ids.silk]),
                );
                expect(result.productIds).not.toContain(ids.hidden);
            }
        }
    });

    it('matches every word, in any script, and ranks the best match first', async () => {
        expect((await search({ term: 'cotton পাঞ্জাবি' })).productIds).toEqual([ids.cotton]);
        expect((await search({ term: 'সিল্ক panjabi' }, 'en')).productIds[0]).toBe(ids.silk);
        // Category names count too: "men" finds what's in Men and its subcategories.
        expect((await search({ term: 'men' })).productIds.sort()).toEqual(
            [ids.cotton, ids.silk, ids.shirt].sort(),
        );
    });

    it('finds a product that only has a Bangla name on the English site', async () => {
        expect((await search({ term: 'নকশি' }, 'en')).productIds).toEqual([ids.kantha]);
    });

    it('says what a typo meant', async () => {
        const result = await search({ term: 'panjbai' });
        expect(result.didYouMean).toBe('panjabi');
        expect(result.productIds).toEqual(expect.arrayContaining([ids.cotton, ids.silk]));
    });

    it('keeps sold-out products findable but counts what is in stock', async () => {
        const result = await search({ term: 'jamdani' });
        expect(result.productIds).toEqual([ids.saree]);
        expect(result.inStockCount).toBe(0);
        expect((await search({ term: 'jamdani', inStockOnly: true })).totalItems).toBe(0);
    });
});

describe('categories and filters', () => {
    it('lists a category with its subcategory, featured first', async () => {
        const result = await search({ collectionId: men });
        expect(result.totalItems).toBe(3);
        expect(result.productIds[0]).toBe(ids.silk);
        expect((await search({ collectionId: panjabiCategory })).productIds.sort()).toEqual(
            [ids.cotton, ids.silk].sort(),
        );
    });

    it('filters by size per variation: XL in stock leaves out the sold-out XL', async () => {
        const all = await search({
            collectionId: panjabiCategory,
            filters: [{ key: 'size', values: ['xl'] }],
        });
        expect(all.totalItems).toBe(2);
        const inStock = await search({
            collectionId: panjabiCategory,
            filters: [{ key: 'size', values: ['xl'] }],
            inStockOnly: true,
        });
        expect(inStock.productIds).toEqual([ids.silk]);
        const size = inStock.filters.find(filter => filter.key === 'size')!;
        expect(size.values).toEqual([
            { value: 'm', label: 'M', count: 2, selected: false },
            { value: 'l', label: 'L', count: 2, selected: false },
            { value: 'xl', label: 'XL', count: 1, selected: true },
        ]);
    });

    it('filters by colour with labels in the page language, and by tag', async () => {
        const bn = await search({ collectionId: men, filters: [{ key: 'colour', values: ['black'] }] });
        expect(bn.productIds).toEqual([ids.shirt]);
        expect(
            bn.filters
                .find(filter => filter.key === 'colour')!
                .values.map(value => value.label)
                .sort(),
        ).toEqual(['কালো', 'সাদা'].sort());
        const tag = await search({ collectionId: men, filters: [{ key: 'tag', values: ['eid'] }] }, 'en');
        expect(tag.productIds).toEqual([ids.cotton]);
        expect(tag.filters.find(filter => filter.key === 'tag')).toMatchObject({
            kind: 'facet',
            label: 'Tag',
        });
    });

    it('filters by price in whole taka, swapping a range typed the wrong way round', async () => {
        const result = await search({ collectionId: men, priceMin: 2000, priceMax: 1000 });
        expect(result.productIds).toEqual([ids.cotton]);
        expect(result.priceRange).toEqual({ min: tk(990), max: tk(2500) });
        expect((await search({ collectionId: men, priceMin: 2000 })).productIds).toEqual([ids.silk]);
    });

    it('sorts by price and pages', async () => {
        const ascending = await search({ collectionId: men, sort: 'PRICE_ASC' });
        expect(ascending.productIds).toEqual([ids.shirt, ids.cotton, ids.silk]);
        const descending = await search({ collectionId: men, sort: 'PRICE_DESC', take: 1, skip: 1 });
        expect(descending.productIds).toEqual([ids.cotton]);
        expect((await search({ collectionId: men, sort: 'POPULAR' })).totalItems).toBe(3);
        // At most 48 per page.
        expect((await search({ take: 500 })).productIds.length).toBeLessThanOrEqual(48);
    });
});

describe('suggestions', () => {
    it('suggests nothing below 2 characters', async () => {
        const { bdSearchSuggestions } = await shopClient.query(SUGGEST, { term: 'p' });
        expect(bdSearchSuggestions).toEqual({ productIds: [], collections: [], didYouMean: null });
    });

    it('suggests products and categories, with the category path', async () => {
        const { bdSearchSuggestions } = await shopClient.query(
            SUGGEST,
            { term: 'panj' },
            { languageCode: 'en' },
        );
        expect(bdSearchSuggestions.productIds).toEqual(expect.arrayContaining([ids.cotton, ids.silk]));
        expect(bdSearchSuggestions.collections[0]).toMatchObject({ id: panjabiCategory, name: 'Panjabi' });
        expect(bdSearchSuggestions.collections[0].slugs).toHaveLength(2);
    });
});

describe('synonyms and searches with no results (Admin API)', () => {
    it('starts with the starter synonyms and validates changes', async () => {
        const { bdSearchSettings } = await adminClient.query(SETTINGS);
        expect(bdSearchSettings.synonyms).toEqual(
            expect.arrayContaining([['panjabi', 'punjabi', 'পাঞ্জাবি']]),
        );
        const { updateBdSearchSettings: invalid } = await adminClient.query(UPDATE_SETTINGS, {
            input: { synonyms: [['kantha']] },
        });
        expect(invalid).toEqual({ settings: null, errors: [{ path: 'synonyms.0', code: 'required' }] });
    });

    it('applies a new synonym at once', async () => {
        expect((await search({ term: 'kantha' })).totalItems).toBe(0);
        const { updateBdSearchSettings } = await adminClient.query(UPDATE_SETTINGS, {
            input: { synonyms: [['kantha', 'কাঁথা']] },
        });
        expect(updateBdSearchSettings.errors).toEqual([]);
        expect((await search({ term: 'kantha' })).productIds).toEqual([ids.kantha]);
    });

    it('counts searches that found nothing, but not phone numbers, filtered or later pages', async () => {
        await search({ term: 'Jeans', recordMiss: true });
        await search({ term: 'jeans', recordMiss: true });
        await search({ term: 'jeans' });
        await search({ term: 'jeans', recordMiss: true, inStockOnly: true });
        await search({ term: 'jeans', recordMiss: true, skip: 24 });
        await search({ term: '01712345678', recordMiss: true });
        await search({ term: 'rahim@example.com', recordMiss: true });
        await search({ term: 'panjabi', recordMiss: true });
        const { bdSearchMisses } = await adminClient.query(MISSES);
        expect(bdSearchMisses).toEqual([{ term: 'jeans', count: 2 }]);
    });

    it('deletes no-result searches after 30 days', async () => {
        const connection = server.app.get(TransactionalConnection).rawConnection;
        await connection.query(
            `INSERT INTO bd_search_miss ("channelId", term, day, count) VALUES (1, 'old term', '2020-01-01', 3)`,
        );
        expect(await server.app.get(BdSearchService).deleteOldMisses()).toBe(1);
        const { bdSearchMisses } = await adminClient.query(MISSES);
        expect(bdSearchMisses.map((row: { term: string }) => row.term)).toEqual(['jeans']);
    });

    it('needs the ManageContent permission', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(MISSES)).rejects.toThrow(/not currently authorized/);
        await expect(adminClient.query(UPDATE_SETTINGS, { input: { synonyms: [] } })).rejects.toThrow(
            /not currently authorized/,
        );
        await adminClient.asSuperAdmin();
    });
});

describe('rate limits', () => {
    it('refuses too many suggestion requests from one address with RATE_LIMITED', async () => {
        let refused: { message: string; code?: string } | null = null;
        for (let attempt = 0; attempt < 20 && !refused; attempt++) {
            try {
                await shopClient.query(SUGGEST, { term: `te${attempt}` }, { languageCode: 'en' });
            } catch (error) {
                const graphQLError = (
                    error as {
                        response?: { errors?: Array<{ message: string; extensions?: { code?: string } }> };
                    }
                ).response?.errors?.[0];
                refused = {
                    message: graphQLError?.message ?? String(error),
                    code: graphQLError?.extensions?.code,
                };
            }
        }
        expect(refused).toEqual({
            message: 'Too many searches. Please wait a minute and try again.',
            code: 'RATE_LIMITED',
        });
    });
});

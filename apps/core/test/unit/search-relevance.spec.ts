import { defaultSearchSettings } from '@ecommbd/shared';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/plugins/bd-search/catalog';
import { runSearch, type SearchQuery } from '../../src/plugins/bd-search/search-engine';
import { CORPUS, corpusRows, keyOf } from '../fixtures/search-corpus';

/**
 * The search relevance suite (roadmap phase 13): a 200-product Bangla/English catalogue and the
 * top 3 results expected for each query, typos, synonyms, mixed scripts and Bangla digits included.
 * A regression suite: when matching or ranking changes, these must still hold.
 */

const rows = corpusRows();
const catalogs = { bn: buildCatalog(rows, 'bn', 'bn'), en: buildCatalog(rows, 'en', 'bn') };
const synonyms = defaultSearchSettings().synonyms;
const ZWJ = String.fromCodePoint(0x200d);
const RRA = String.fromCodePoint(0x9dc);

function search(query: SearchQuery, lang: 'bn' | 'en' = 'bn') {
    return runSearch(catalogs[lang], { synonyms, ...query });
}

function top3(term: string, lang: 'bn' | 'en' = 'bn', withSynonyms = true) {
    return runSearch(catalogs[lang], {
        term,
        take: 3,
        synonyms: withSynonyms ? synonyms : [],
    }).productIds.map(keyOf);
}

const colourOf = (key: string, colour: string) =>
    !!CORPUS.find(item => item.key === key)?.option?.values.some(value => value[0] === colour);
const categoryOf = (key: string) => CORPUS.find(item => item.key === key)!.category;

type Expectation = { first: string } | { all: (key: string) => boolean; label: string } | { none: true };

const isPanjabi = { all: (key: string) => key.endsWith('panjabi'), label: 'panjabi' };
const isSaree = {
    all: (key: string) => key.includes('saree') && key !== 'silk-saree-sold-out',
    label: 'saree in stock',
};

const CASES: Array<[query: string, lang: 'bn' | 'en', expectation: Expectation]> = [
    // Bangla, English and Banglish spellings of the same thing.
    ['পাঞ্জাবি', 'bn', isPanjabi],
    ['panjabi', 'bn', isPanjabi],
    ['panjabi', 'en', isPanjabi],
    ['পাঞ্জাবি', 'en', isPanjabi],
    ['punjabi', 'bn', isPanjabi],
    ['পাঞ্জাবী', 'bn', isPanjabi],
    ['panjbi', 'bn', isPanjabi],
    ['পাঞ্জা', 'bn', isPanjabi],
    ['panj', 'en', isPanjabi],
    ['pan', 'en', { first: 'non-stick-pan' }],
    // Several words, any order, mixed scripts.
    ['সুতির পাঞ্জাবি', 'bn', { all: key => key.endsWith('cotton-panjabi'), label: 'cotton panjabi' }],
    ['cotton panjabi', 'en', { all: key => key.endsWith('cotton-panjabi'), label: 'cotton panjabi' }],
    [
        'black panjabi',
        'en',
        { all: key => key.startsWith('black-') && key.endsWith('panjabi'), label: 'black panjabi' },
    ],
    [
        'কালো পাঞ্জাবি',
        'bn',
        { all: key => key.startsWith('black-') && key.endsWith('panjabi'), label: 'black panjabi' },
    ],
    [
        'black পাঞ্জাবি',
        'bn',
        { all: key => key.startsWith('black-') && key.endsWith('panjabi'), label: 'black panjabi' },
    ],
    [
        'পাঞ্জাবি কালো',
        'bn',
        { all: key => key.startsWith('black-') && key.endsWith('panjabi'), label: 'black panjabi' },
    ],
    ['black silk panjabi', 'en', { first: 'black-silk-panjabi' }],
    ['men panjabi', 'en', isPanjabi],
    // Saree.
    ['jamdani', 'bn', { all: key => key.startsWith('jamdani-saree'), label: 'jamdani' }],
    ['জামদানী', 'bn', { all: key => key.startsWith('jamdani-saree'), label: 'jamdani' }],
    ['jamd', 'en', { all: key => key.startsWith('jamdani-saree'), label: 'jamdani' }],
    ['saree', 'en', isSaree],
    ['sari', 'en', isSaree],
    ['শাড়ী', 'bn', isSaree],
    ['red saree', 'en', { all: key => key.includes('saree') && colourOf(key, 'red'), label: 'red saree' }],
    ['লাল শাড়ি', 'bn', { all: key => key.includes('saree') && colourOf(key, 'red'), label: 'red saree' }],
    ['katan', 'en', { all: key => key.startsWith('katan-saree'), label: 'katan' }],
    ['silk saree', 'en', { first: 'silk-saree' }],
    // Women's clothing.
    ['kurti', 'en', { all: key => key.endsWith('kurti'), label: 'kurti' }],
    ['kurtee', 'en', { all: key => key.endsWith('kurti'), label: 'kurti' }],
    ['t-shirt', 'en', { all: key => key.endsWith('t-shirt'), label: 't-shirt' }],
    ['tshirt', 'bn', { all: key => key.endsWith('t-shirt'), label: 't-shirt' }],
    ['টি-শার্ট', 'bn', { all: key => key.endsWith('t-shirt'), label: 't-shirt' }],
    ['tee', 'en', { all: key => key.endsWith('t-shirt'), label: 't-shirt' }],
    ['three piece', 'en', { all: key => key.endsWith('three-piece'), label: 'three-piece' }],
    ['থ্রি পিস', 'bn', { all: key => key.endsWith('three-piece'), label: 'three-piece' }],
    ['threepiece', 'en', { all: key => key.endsWith('three-piece'), label: 'three-piece' }],
    ['burqa', 'en', { all: key => key.endsWith('borka'), label: 'borka' }],
    ['বোরকা', 'bn', { all: key => key.endsWith('borka'), label: 'borka' }],
    // Food, with Bangla digits.
    ['honey', 'en', { all: key => key.endsWith('honey'), label: 'honey' }],
    ['মধু', 'bn', { all: key => key.endsWith('honey'), label: 'honey' }],
    ['সুন্দরবনের মধু', 'bn', { first: 'sundarban-honey' }],
    ['ghee 500', 'en', { first: 'gawa-ghee-500-g' }],
    ['ঘি ৫০০ গ্রাম', 'bn', { first: 'gawa-ghee-500-g' }],
    ['ajwa', 'en', { first: 'ajwa-dates' }],
    ['খেজুর', 'bn', { all: key => key.endsWith('dates'), label: 'dates' }],
    ['chia', 'en', { first: 'chia-seeds' }],
    // Gadgets and SKUs.
    ['smart watch', 'en', { first: 'smart-watch' }],
    ['স্মার্ট ঘড়ি', 'bn', { first: 'smart-watch' }],
    ['headphone', 'en', { first: 'wireless-headphones' }],
    ['power bank', 'en', { first: 'power-bank-10000mah' }],
    ['charger 20w', 'en', { first: 'fast-charger-20w' }],
    ['PNJ-COT-BLK', 'en', { first: 'black-cotton-panjabi' }],
    ['watch for men', 'en', { first: 'mens-leather-watch' }],
    // Beauty, shoes, bags, home.
    ['attar', 'en', { all: key => key.includes('attar'), label: 'attar' }],
    ['আতর', 'bn', { all: key => key.includes('attar'), label: 'attar' }],
    ['perfume', 'en', { all: key => key.startsWith('perfume'), label: 'perfume' }],
    ['lipstik', 'en', { all: key => key.endsWith('lipstick'), label: 'lipstick' }],
    ['sneaker', 'en', { first: 'sneakers' }],
    ['leather bag', 'en', { first: 'leather-bag' }],
    ['চামড়ার ব্যাগ', 'bn', { first: 'leather-bag' }],
    // Unicode variants: ড় typed as one character; র্য typed with and without the joiner (ZWJ).
    [`ব${RRA} ব্যাগ`, 'bn', { first: 'big-travel-bag' }],
    ['বই র্যাক', 'bn', { first: 'book-rack' }],
    [`বই র${ZWJ}্যাক`, 'bn', { first: 'book-rack' }],
    // Bangla-only products; words nobody sells.
    ['নকশি', 'bn', { first: 'bn-kantha' }],
    ['xyzabc', 'en', { none: true }],
    ['jeans', 'en', { none: true }],
];

describe('search relevance (200 products, Bangla and English)', () => {
    it('has a catalogue of about 200 products', () => {
        expect(CORPUS.length).toBeGreaterThanOrEqual(195);
        expect(CASES.length).toBeGreaterThanOrEqual(50);
    });

    it.each(CASES)('%s (%s)', (query, lang, expectation) => {
        const results = top3(query, lang);
        if ('none' in expectation) {
            expect(results).toEqual([]);
        } else if ('first' in expectation) {
            expect(results[0]).toBe(expectation.first);
        } else {
            // Three results, or every product of that kind when there are fewer.
            const available = CORPUS.filter(
                item => item.inStock !== false && expectation.all(item.key),
            ).length;
            expect(results, expectation.label).toHaveLength(Math.min(3, available));
            for (const key of results)
                expect(expectation.all(key), `${key} is ${expectation.label}`).toBe(true);
        }
    });

    it('finds typos without synonyms, and says what it meant', () => {
        expect(top3('punjabi', 'en', false).every(key => key.endsWith('panjabi'))).toBe(true);
        expect(search({ term: 'punjabi', synonyms: [] }).didYouMean).toBe('panjabi');
        expect(search({ term: 'kurtee' }).didYouMean).toBe('kurti');
        expect(search({ term: 'lipstik black' }).didYouMean).toBe('lipstick black');
        // Correct words need no correction.
        expect(search({ term: 'panjabi' }).didYouMean).toBeNull();
    });

    it('puts out-of-stock products last', () => {
        const ids = search({ term: 'silk saree', take: 50 }).productIds.map(keyOf);
        expect(ids[ids.length - 1]).toBe('silk-saree-sold-out');
        expect(ids.indexOf('silk-saree')).toBeLessThan(ids.indexOf('silk-saree-sold-out'));
    });

    it('treats SQL and regex characters as text', () => {
        // Only the words count: the same as searching "drop table product".
        expect(search({ term: `'; DROP TABLE product; --` }).productIds).toEqual(
            search({ term: 'drop table product' }).productIds,
        );
        expect(search({ term: '.*' }).total).toBe(0);
        expect(search({ term: '(panjabi' }).total).toBe(search({ term: 'panjabi' }).total);
    });
});

describe('filters, counts and sorting', () => {
    const panjabi = '2';
    const men = '1';

    it('lists a category with its subcategories', () => {
        const inPanjabi = search({ collectionId: panjabi, take: 100 });
        const inMen = search({ collectionId: men, take: 200 });
        expect(inPanjabi.total).toBe(18);
        expect(inMen.total).toBeGreaterThan(inPanjabi.total);
        expect(inMen.productIds.map(keyOf)).toEqual(expect.arrayContaining(inPanjabi.productIds.map(keyOf)));
        expect(inMen.productIds.map(keyOf).every(key => ['2', '3', '4', '5'].includes(categoryOf(key)))).toBe(
            true,
        );
    });

    it('filters by size and counts each value ignoring its own filter', () => {
        const all = search({ collectionId: '20', take: 50 });
        const size = all.filters.find(filter => filter.key === 'size')!;
        expect(size.kind).toBe('option');
        expect(size.values.map(value => value.value)).toEqual(['40', '41', '42', '43', '44']);
        const filtered = search({ collectionId: '20', filters: new Map([['size', new Set(['42'])]]) });
        expect(filtered.total).toBe(4);
        const sizeAfter = filtered.filters.find(filter => filter.key === 'size')!;
        // The other sizes stay visible with their counts.
        expect(sizeAfter.values.find(value => value.value === '44')).toMatchObject({
            count: 4,
            selected: false,
        });
        expect(sizeAfter.values.find(value => value.value === '42')).toMatchObject({
            count: 4,
            selected: true,
        });
    });

    it('orders sizes the way shops do', () => {
        const size = search({ collectionId: panjabi }).filters.find(filter => filter.key === 'size')!;
        expect(size.values.map(value => value.label)).toEqual(['M', 'L', 'XL', 'XXL']);
    });

    it('filters by colour with Bangla labels, OR inside a filter and AND across filters', () => {
        const sarees = '7';
        const colour = search({ collectionId: sarees }).filters.find(filter => filter.key === 'colour')!;
        expect(colour.values.find(value => value.value === 'red')?.label).toBe('লাল');
        const redOrMaroon = search({
            collectionId: sarees,
            filters: new Map([['colour', new Set(['red', 'maroon'])]]),
            take: 50,
        });
        expect(redOrMaroon.total).toBe(12);
        const withTag = search({
            collectionId: sarees,
            filters: new Map([
                ['colour', new Set(['red'])],
                ['tag', new Set(['eid'])],
            ]),
        });
        expect(withTag.productIds.map(keyOf)).toEqual(['jamdani-saree']);
        // An unknown value finds nothing (the storefront then offers to remove filters).
        expect(
            search({ collectionId: sarees, filters: new Map([['colour', new Set(['purple'])]]) }).total,
        ).toBe(0);
    });

    it('checks filters per variation: a size must be the one in stock', () => {
        const catalog = buildCatalog(
            {
                ...rows,
                index: rows.index.map(row =>
                    row.productId === '1' && row.sku.endsWith('-XL') ? { ...row, inStock: false } : row,
                ),
            },
            'en',
            'bn',
        );
        const xlInStock = runSearch(catalog, {
            collectionId: '2',
            filters: new Map([['size', new Set(['xl'])]]),
            inStockOnly: true,
            take: 50,
        });
        expect(xlInStock.productIds).not.toContain('1');
        expect(xlInStock.total).toBe(17);
    });

    it('filters by price (poisha) and reports the range ignoring the price filter', () => {
        const result = search({
            collectionId: panjabi,
            priceMin: 1000 * 100,
            priceMax: 2000 * 100,
            take: 50,
        });
        expect(result.total).toBe(13);
        expect(result.priceRange).toEqual({ min: 450 * 100, max: 2400 * 100 });
    });

    it('counts products in stock ignoring the in-stock filter', () => {
        const result = search({ collectionId: '7', inStockOnly: true, take: 50 });
        expect(result.total).toBe(12);
        expect(result.inStockCount).toBe(12);
        expect(search({ collectionId: '7', take: 50 }).total).toBe(13);
    });

    it('sorts by price, newest, popularity and featured, with out-of-stock last', () => {
        const prices = (sort: SearchQuery['sort']) =>
            search({ collectionId: '7', sort, take: 50 }).productIds.map(id => CORPUS[Number(id) - 1]!.price);
        const ascending = prices('price-asc');
        expect(ascending.slice(0, -1)).toEqual([...ascending.slice(0, -1)].sort((a, b) => a - b));
        const descending = prices('price-desc');
        expect(descending.slice(0, -1)).toEqual([...descending.slice(0, -1)].sort((a, b) => b - a));
        // The sold-out saree (৳3,000) is last whatever the order.
        expect(keyOf(search({ collectionId: '7', sort: 'price-asc', take: 50 }).productIds.slice(-1)[0]!)).toBe(
            'silk-saree-sold-out',
        );
        const newest = search({ collectionId: panjabi, sort: 'newest', take: 3 }).productIds.map(Number);
        expect(newest).toEqual([...newest].sort((a, b) => a - b));
        expect(keyOf(search({ collectionId: panjabi, sort: 'popular' }).productIds[0]!)).toMatch(
            /cotton-panjabi$/,
        );
    });

    it('lists featured products first by default in a category', () => {
        const catalog = buildCatalog(
            {
                ...rows,
                products: rows.products.map(row => (row.id === '30' ? { ...row, featured: true } : row)),
            },
            'en',
            'bn',
        );
        const featured = keyOf('30');
        const category = CORPUS[29]!.category;
        expect(keyOf(runSearch(catalog, { collectionId: category }).productIds[0]!)).toBe(featured);
    });

    it('pages through big result sets', () => {
        const all = search({ take: 48 });
        expect(all.total).toBe(CORPUS.length);
        expect(all.productIds).toHaveLength(48);
        const last = search({ take: 48, skip: 192 });
        expect(last.productIds.length).toBe(CORPUS.length - 192);
        expect(search({ take: 48, skip: 1000 }).productIds).toEqual([]);
    });
});

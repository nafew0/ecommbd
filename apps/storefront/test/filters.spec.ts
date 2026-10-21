import { describe, expect, it } from 'vitest';
import {
    canonicalListingSearch,
    clearFilters,
    isRefined,
    listingQuery,
    parseListing,
    toggleFilter,
} from '../src/lib/filters';

const parse = (query: string, kind: 'category' | 'search' = 'category') =>
    parseListing(new URL(`https://shop.test/x/${query}`).searchParams, kind);
const canonical = (query: string, kind: 'category' | 'search' = 'category') =>
    canonicalListingSearch(new URL(`https://shop.test/x/${query}`), kind);

describe('listing state in the address', () => {
    it('reads filters, price, stock, order and page', () => {
        expect(
            parse(
                '?filter.size=m&filter.size=l&filter.colour=red&filter.price.min=500&filter.price.max=900&filter.stock=in&sort=price-asc&page=2',
            ),
        ).toEqual({
            q: '',
            filters: [
                { key: 'colour', values: ['red'] },
                { key: 'size', values: ['l', 'm'] },
            ],
            priceMin: 500,
            priceMax: 900,
            inStock: true,
            sort: 'price-asc',
            page: 2,
        });
    });

    it('writes one spelling: keys and values sorted, defaults and empty values left out', () => {
        const state = parse(
            '?sort=featured&filter.size=m&filter.colour=red&filter.size=l&filter.price.min=&page=1',
        );
        expect(listingQuery(state, 'category')).toBe('?filter.colour=red&filter.size=l&filter.size=m');
        expect(listingQuery(parse(''), 'category')).toBe('');
    });

    it('swaps a price range typed the wrong way round, and accepts Bangla digits and ৳', () => {
        const state = parse('?filter.price.min=%E0%A7%AF%E0%A7%A6%E0%A7%A6&filter.price.max=%E0%A7%B3500');
        expect([state.priceMin, state.priceMax]).toEqual([500, 900]);
        expect(parse('?filter.price.min=abc&filter.price.max=-5').priceMin).toBeNull();
    });

    it('ignores bad keys, extreme pages and unknown orders', () => {
        const state = parse('?filter.<script>=1&filter.size=M&page=99999&sort=cheapest');
        expect(state.filters).toEqual([{ key: 'size', values: ['m'] }]);
        expect(state.page).toBe(1000);
        expect(state.sort).toBe('featured');
        expect(parse('?page=-3').page).toBe(1);
    });

    it('caps how many filters a URL can carry', () => {
        const many = Array.from({ length: 30 }, (_, index) => `filter.size=v${index}`).join('&');
        expect(parse(`?${many}`).filters[0]!.values).toHaveLength(20);
        const keys = Array.from({ length: 15 }, (_, index) => `filter.k${index}=a`).join('&');
        expect(parse(`?${keys}`).filters).toHaveLength(10);
    });

    it('keeps Bangla values, encoded', () => {
        const state = parse('?filter.colour=%E0%A6%B2%E0%A6%BE%E0%A6%B2');
        expect(state.filters).toEqual([{ key: 'colour', values: ['লাল'] }]);
        expect(listingQuery(state, 'category')).toBe('?filter.colour=%E0%A6%B2%E0%A6%BE%E0%A6%B2');
    });
});

describe('search pages', () => {
    it('defaults to relevance with words, newest without', () => {
        expect(parse('?q=panjabi', 'search').sort).toBe('relevance');
        expect(parse('', 'search').sort).toBe('newest');
        expect(parse('?sort=relevance', 'search').sort).toBe('newest');
        expect(listingQuery(parse('?q=%20black%20%20panjabi%20&sort=relevance', 'search'), 'search')).toBe(
            '?q=black%20panjabi',
        );
    });
});

describe('canonical redirects (cache-key normalization)', () => {
    it('leaves the canonical spelling alone, also with + for spaces', () => {
        expect(canonical('?filter.colour=red&filter.size=l&filter.size=m')).toBeNull();
        expect(canonical('?q=black+panjabi', 'search')).toBeNull();
        expect(canonical('')).toBeNull();
    });

    it('rewrites any other spelling of the same state to one address', () => {
        expect(canonical('?filter.size=m&filter.size=l')).toBe('?filter.size=l&filter.size=m');
        expect(canonical('?filter.size=l,m')).toBe('?filter.size=l&filter.size=m');
        expect(canonical('?sort=featured&page=1&filter.price.min=')).toBe('');
        expect(canonical('?filter.price.min=900&filter.price.max=500')).toBe(
            '?filter.price.max=900&filter.price.min=500',
        );
    });

    it('keeps tracking parameters after the listing’s own', () => {
        expect(canonical('?utm_source=fb&page=1')).toBe('?utm_source=fb');
        expect(canonical('?utm_source=fb&page=2')).toBeNull();
        expect(canonical('?sort=newest&fbclid=x&filter.size=m')).toBe('?filter.size=m&sort=newest&fbclid=x');
    });
});

describe('changing the state', () => {
    it('toggles a value and goes back to page 1', () => {
        const state = parse('?filter.size=m&page=3');
        expect(listingQuery(toggleFilter(state, 'size', 'l'), 'category')).toBe(
            '?filter.size=l&filter.size=m',
        );
        expect(listingQuery(toggleFilter(state, 'size', 'm'), 'category')).toBe('');
        expect(listingQuery(toggleFilter(state, 'colour', 'red'), 'category')).toBe(
            '?filter.colour=red&filter.size=m',
        );
    });

    it('clears filters but keeps the words and the order', () => {
        const state = parse('?q=saree&filter.stock=in&filter.price.min=100&sort=newest', 'search');
        expect(isRefined(state, 'search')).toBe(true);
        expect(listingQuery(clearFilters(state), 'search')).toBe('?q=saree&sort=newest');
        expect(isRefined(parse('?q=saree', 'search'), 'search')).toBe(false);
    });
});

import { banglaToAsciiDigits } from '@ecommbd/shared/text';

/**
 * Category and search page state in the address (roadmap phase 13), read and written the same way
 * on the server and in the browser:
 *
 *     ?filter.colour=red&filter.price.max=900&filter.price.min=500&filter.size=l&filter.size=m
 *      &filter.stock=in&page=2&q=panjabi&sort=price-asc
 *
 * Each state has one spelling: keys in alphabetical order, values sorted, defaults and empty values
 * left out. Any other spelling gets one 301 to it (docs/decisions.md), so caches see one URL.
 */

export type ListingKind = 'category' | 'search';

export type SortOption = 'relevance' | 'featured' | 'newest' | 'price-asc' | 'price-desc' | 'popular';

export interface ListingState {
    /** The search words (search page only). */
    q: string;
    /** Facet and option filters: keys sorted, values sorted and unique. */
    filters: Array<{ key: string; values: string[] }>;
    /** Whole taka. */
    priceMin: number | null;
    priceMax: number | null;
    inStock: boolean;
    sort: SortOption;
    page: number;
}

export const FILTER_LIMITS = {
    keys: 10,
    values: 20,
    value: 100,
    query: 100,
    page: 1000,
    taka: 9_999_999,
} as const;

const KEY = /^[\p{L}\p{N}_-]{1,50}$/u;
const RESERVED = new Set(['price.min', 'price.max', 'stock']);

/** The sort orders a page offers, the default first. */
export function sortOptions(kind: ListingKind, hasQuery: boolean): SortOption[] {
    if (kind === 'category') return ['featured', 'newest', 'price-asc', 'price-desc', 'popular'];
    return hasQuery
        ? ['relevance', 'newest', 'price-asc', 'price-desc', 'popular']
        : ['newest', 'price-asc', 'price-desc', 'popular'];
}

export function defaultSort(kind: ListingKind, hasQuery: boolean): SortOption {
    return sortOptions(kind, hasQuery)[0]!;
}

/** Whether a query parameter belongs to the listing (others, like `utm_source`, are left alone). */
export function isListingParam(name: string): boolean {
    return name.startsWith('filter.') || name === 'sort' || name === 'page' || name === 'q';
}

/** Whole taka from what was typed: Bangla digits, `৳`, commas and spaces are fine. */
function parseTaka(input: string | null): number | null {
    if (!input) return null;
    const digits = banglaToAsciiDigits(input).replace(/[\s,৳]/g, '');
    if (!/^\d{1,7}$/.test(digits)) return null;
    return Math.min(Number(digits), FILTER_LIMITS.taka);
}

export function parseListing(params: URLSearchParams, kind: ListingKind): ListingState {
    const q =
        kind === 'search'
            ? (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, FILTER_LIMITS.query)
            : '';
    const filters = new Map<string, Set<string>>();
    for (const [name, raw] of params) {
        if (!name.startsWith('filter.')) continue;
        const key = name.slice('filter.'.length).toLowerCase();
        if (RESERVED.has(key) || !KEY.test(key)) continue;
        if (!filters.has(key) && filters.size >= FILTER_LIMITS.keys) continue;
        const values = filters.get(key) ?? new Set<string>();
        for (const part of raw.split(',')) {
            const value = part.trim().toLowerCase().slice(0, FILTER_LIMITS.value);
            if (value && values.size < FILTER_LIMITS.values) values.add(value);
        }
        if (values.size) filters.set(key, values);
    }
    let priceMin = parseTaka(params.get('filter.price.min'));
    let priceMax = parseTaka(params.get('filter.price.max'));
    // A range typed the wrong way round is swapped.
    if (priceMin != null && priceMax != null && priceMin > priceMax)
        [priceMin, priceMax] = [priceMax, priceMin];
    const sorts = sortOptions(kind, !!q);
    const sort = sorts.includes(params.get('sort') as SortOption)
        ? (params.get('sort') as SortOption)
        : sorts[0]!;
    const page = Number.parseInt(params.get('page') ?? '', 10);
    return {
        q,
        filters: [...filters]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, values]) => ({ key, values: [...values].sort() })),
        priceMin,
        priceMax,
        inStock: params.get('filter.stock') === 'in',
        sort,
        page: Number.isFinite(page) && page > 1 ? Math.min(page, FILTER_LIMITS.page) : 1,
    };
}

const encode = (pairs: Array<[string, string]>) =>
    pairs.length ? `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}` : '';

/** The one spelling of a state's query string (`?…`, or empty). */
export function listingQuery(state: ListingState, kind: ListingKind): string {
    const pairs: Array<[string, string]> = [];
    for (const { key, values } of state.filters)
        for (const value of values) pairs.push([`filter.${key}`, value]);
    if (state.priceMax != null) pairs.push(['filter.price.max', String(state.priceMax)]);
    if (state.priceMin != null) pairs.push(['filter.price.min', String(state.priceMin)]);
    if (state.inStock) pairs.push(['filter.stock', 'in']);
    if (state.page > 1) pairs.push(['page', String(state.page)]);
    if (state.q) pairs.push(['q', state.q]);
    if (state.sort !== defaultSort(kind, !!state.q)) pairs.push(['sort', state.sort]);
    // Stable: values keep their sorted order within a key.
    return encode(pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The canonical query string when the address spells the state differently, else null. Other
 * parameters (`utm_source`, `fbclid`) are kept, after the listing's own.
 */
export function canonicalListingSearch(url: URL, kind: ListingKind): string | null {
    const own = [...url.searchParams].filter(([name]) => isListingParam(name));
    const canonical = listingQuery(parseListing(url.searchParams, kind), kind);
    if (encode(own) === canonical) return null;
    const others = [...url.searchParams].filter(([name]) => !isListingParam(name));
    const rest = others
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return rest ? `${canonical ? `${canonical}&` : '?'}${rest}` : canonical;
}

/** Filters, a price range, in-stock only or a non-default order: such pages aren't indexed. */
export function isRefined(state: ListingState, kind: ListingKind): boolean {
    return (
        state.filters.length > 0 ||
        state.priceMin != null ||
        state.priceMax != null ||
        state.inStock ||
        state.sort !== defaultSort(kind, !!state.q)
    );
}

/** The same state with changes; back to page 1 unless a page is given. */
export function withState(state: ListingState, change: Partial<ListingState>): ListingState {
    return { ...state, page: 1, ...change };
}

/** Adds or removes one filter value. */
export function toggleFilter(state: ListingState, key: string, value: string): ListingState {
    const current = state.filters.find(filter => filter.key === key)?.values ?? [];
    const values = current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value].sort();
    const filters = state.filters
        .filter(filter => filter.key !== key)
        .concat(values.length ? [{ key, values }] : [])
        .sort((a, b) => (a.key < b.key ? -1 : 1));
    return withState(state, { filters });
}

/** Every filter off; the search words and the order stay. */
export function clearFilters(state: ListingState): ListingState {
    return withState(state, { filters: [], priceMin: null, priceMax: null, inStock: false });
}

/** The Shop API's names for the orders (`BdSearchSort`). */
export const SEARCH_SORT_ENUM = {
    relevance: 'RELEVANCE',
    featured: 'FEATURED',
    newest: 'NEWEST',
    'price-asc': 'PRICE_ASC',
    'price-desc': 'PRICE_DESC',
    popular: 'POPULAR',
} as const satisfies Record<SortOption, string>;

import { editDistance, queryWords, searchWords, trigramSimilarity } from '@ecommbd/shared';

/**
 * Product search, filters, counts and sorting (roadmap phase 13), as pure functions over a catalog
 * loaded from Vendure's search index (see search.service.ts). Matching runs here rather than in
 * PostgreSQL so Bangla is split into words the same way on every server (docs/decisions.md).
 */

export type OptionDimension = 'size' | 'colour';
export const OPTION_DIMENSIONS: readonly OptionDimension[] = ['size', 'colour'];

export const SEARCH_SORTS = [
    'relevance',
    'featured',
    'newest',
    'price-asc',
    'price-desc',
    'popular',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** How much a word counts by where it was found. */
export const FIELD_WEIGHTS = {
    name: 1,
    sku: 0.9,
    variant: 0.6,
    option: 0.6,
    category: 0.5,
    facet: 0.5,
} as const;

/** How much a word counts by how it matched. */
const MATCH = { exact: 1, synonym: 0.9, prefix: 0.7, loose: 0.45, loosePrefix: 0.35 } as const;

export interface CatalogVariant {
    id: string;
    /** With tax, in poisha. */
    price: number;
    inStock: boolean;
    facetValueIds: string[];
    options: Array<{ dimension: OptionDimension; code: string }>;
}

export interface CatalogProduct {
    id: string;
    createdAt: number;
    featured: boolean;
    /** Units delivered recently (phase 13: last 90 days). */
    popularity: number;
    collectionIds: Set<string>;
    variants: CatalogVariant[];
    /** Every search word of the product, in every language, with the weight of its best field. */
    words: Map<string, number>;
}

export interface CatalogFacetValue {
    id: string;
    code: string;
    facetCode: string;
    /** In the request's language (falling back to the other). */
    facetName: string;
    name: string;
}

export interface CatalogCollection {
    id: string;
    parentId: string | null;
    name: string;
    /** Slugs from the top category down to this one, in the request's language. */
    slugs: string[];
    words: Map<string, number>;
}

export interface SearchCatalog {
    products: CatalogProduct[];
    /** Every word of every product, for prefix and typo matching. */
    vocabulary: string[];
    facetValues: Map<string, CatalogFacetValue>;
    /** Option labels by `${dimension}:${code}`, in the request's language. */
    optionNames: Map<string, string>;
    collections: Map<string, CatalogCollection>;
}

export interface SearchQuery {
    term?: string;
    /** A category: its products and its subcategories' products. */
    collectionId?: string;
    /** Filter key (an option dimension or a facet code) → chosen values (option or facet value codes). */
    filters?: Map<string, Set<string>>;
    /** Poisha. */
    priceMin?: number;
    priceMax?: number;
    inStockOnly?: boolean;
    sort?: SearchSort;
    skip?: number;
    take?: number;
    /** Synonym groups as the merchant typed them. */
    synonyms?: string[][];
}

export interface FilterValueResult {
    value: string;
    label: string;
    count: number;
    selected: boolean;
}

export interface FilterResult {
    key: string;
    kind: 'option' | 'facet';
    label: string;
    values: FilterValueResult[];
}

export interface SearchOutcome {
    total: number;
    productIds: string[];
    filters: FilterResult[];
    /** Lowest and highest price (poisha) among results, ignoring the price filter. */
    priceRange: { min: number; max: number } | null;
    /** Results in stock, ignoring the in-stock filter. */
    inStockCount: number;
    /** The query with words that matched only loosely replaced by their closest word. */
    didYouMean: string | null;
}

interface Candidate {
    quality: number;
    kind: keyof typeof MATCH;
    similarity: number;
}

interface Alternative {
    words: string[];
    synonym: boolean;
}

interface Slot {
    alternatives: Alternative[];
    /** The query words this slot stands for. */
    original: string[];
}

/** Product words → best weight, from texts and the field they come from. */
export function wordMap(fields: Array<{ text: string; weight: number }>): Map<string, number> {
    const words = new Map<string, number>();
    for (const field of fields) {
        for (const word of searchWords(field.text)) {
            if ((words.get(word) ?? 0) < field.weight) words.set(word, field.weight);
        }
    }
    return words;
}

/** Vocabulary words a query word could mean: exactly, as the start of a longer word, or with a typo. */
function findCandidates(word: string, vocabulary: readonly string[]): Map<string, Candidate> {
    const found = new Map<string, Candidate>();
    const length = [...word].length;
    const maxTypos = length >= 8 ? 2 : 1;
    for (const candidate of vocabulary) {
        if (candidate === word) {
            found.set(candidate, { quality: MATCH.exact, kind: 'exact', similarity: 1 });
            continue;
        }
        if (length >= 2 && candidate.startsWith(word)) {
            // "panj" → "panjabi": closer to the whole word counts a little more.
            const share = length / [...candidate].length;
            found.set(candidate, { quality: MATCH.prefix + 0.2 * share, kind: 'prefix', similarity: share });
            continue;
        }
        if (length < 4) continue;
        const candidateLength = [...candidate].length;
        if (
            Math.abs(candidateLength - length) <= maxTypos &&
            editDistance(word, candidate, maxTypos) <= maxTypos
        ) {
            const similarity = trigramSimilarity(word, candidate);
            found.set(candidate, { quality: MATCH.loose + 0.1 * similarity, kind: 'loose', similarity });
            continue;
        }
        if (candidateLength <= length * 2) {
            const similarity = trigramSimilarity(word, candidate);
            if (similarity >= 0.4) {
                found.set(candidate, { quality: MATCH.loose * similarity * 2, kind: 'loose', similarity });
                continue;
            }
        }
        if (
            length >= 5 &&
            candidateLength > length &&
            editDistance(word, candidate.slice(0, length), 1) <= 1
        ) {
            found.set(candidate, { quality: MATCH.loosePrefix, kind: 'loosePrefix', similarity: 0.5 });
        }
    }
    return found;
}

/**
 * The query as slots: each word on its own, except where a synonym (a word or phrase) appears; that
 * part may then be matched by any term of the synonym's group.
 */
function buildSlots(words: string[], synonyms: string[][]): Slot[] {
    const groups = synonyms.map(group => group.map(term => queryWords(term)).filter(term => term.length));
    const slots: Slot[] = [];
    let index = 0;
    while (index < words.length) {
        let best: { length: number; group: string[][]; term: string[] } | null = null;
        for (const group of groups) {
            for (const term of group) {
                const fits =
                    term.length <= words.length - index &&
                    term.every((word, offset) => words[index + offset] === word);
                if (fits && (!best || term.length > best.length)) best = { length: term.length, group, term };
            }
        }
        if (best) {
            const original = words.slice(index, index + best.length);
            slots.push({
                original,
                alternatives: best.group.map(term => ({ words: term, synonym: term !== best.term })),
            });
            index += best.length;
        } else {
            slots.push({
                original: [words[index]!],
                alternatives: [{ words: [words[index]!], synonym: false }],
            });
            index++;
        }
    }
    return slots;
}

function matchScore(
    words: Map<string, number>,
    slots: Slot[],
    candidates: Map<string, Map<string, Candidate>>,
): number | null {
    let total = 0;
    for (const slot of slots) {
        let best = 0;
        for (const alternative of slot.alternatives) {
            let sum = 0;
            for (const word of alternative.words) {
                const options = candidates.get(word)!;
                let wordBest = 0;
                if (words.size < options.size) {
                    for (const [productWord, weight] of words) {
                        const candidate = options.get(productWord);
                        if (candidate) wordBest = Math.max(wordBest, candidate.quality * weight);
                    }
                } else {
                    for (const [candidateWord, candidate] of options) {
                        const weight = words.get(candidateWord);
                        if (weight) wordBest = Math.max(wordBest, candidate.quality * weight);
                    }
                }
                if (!wordBest) {
                    sum = 0;
                    break;
                }
                sum += wordBest;
            }
            if (sum) {
                const score = (sum / alternative.words.length) * (alternative.synonym ? MATCH.synonym : 1);
                best = Math.max(best, score);
            }
        }
        if (!best) return null;
        total += best;
    }
    return total;
}

/** A category and every category below it. */
export function withDescendants(collections: Map<string, CatalogCollection>, id: string): Set<string> {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const collection of collections.values()) {
            if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) {
                ids.add(collection.id);
                grew = true;
            }
        }
    }
    return ids;
}

const SIZE_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', 'xxxl', '3xl', '4xl', '5xl'];

function compareValues(key: string, a: FilterValueResult, b: FilterValueResult): number {
    if (key === 'size') {
        const ia = SIZE_ORDER.indexOf(a.value);
        const ib = SIZE_ORDER.indexOf(b.value);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
}

/** Runs one search: matching, filters with their counts, price range, sorting and the page. */
export function runSearch(catalog: SearchCatalog, query: SearchQuery): SearchOutcome {
    const filters = query.filters ?? new Map<string, Set<string>>();
    const words = queryWords(query.term ?? '');
    const slots = buildSlots(words, query.synonyms ?? []);
    const candidates = new Map<string, Map<string, Candidate>>();
    for (const slot of slots) {
        for (const alternative of slot.alternatives) {
            for (const word of alternative.words) {
                if (!candidates.has(word)) candidates.set(word, findCandidates(word, catalog.vocabulary));
            }
        }
    }
    // A word no product has at all ("for" in "watch for men") is left out while other words match.
    const known = slots.filter(slot =>
        slot.alternatives.some(alternative =>
            alternative.words.every(word => candidates.get(word)!.size > 0),
        ),
    );
    const matching = known.length ? known : slots;
    const scope = query.collectionId ? withDescendants(catalog.collections, query.collectionId) : null;
    const facetCodes = new Set([...catalog.facetValues.values()].map(value => value.facetCode));

    // Products that match the words and the category: the base every count is made from.
    const base: Array<{ product: CatalogProduct; score: number }> = [];
    // A term with no words in it (".*", "!!") finds nothing rather than everything.
    const wordless = !!query.term?.trim() && !words.length;
    for (const product of wordless ? [] : catalog.products) {
        if (scope && ![...product.collectionIds].some(id => scope.has(id))) continue;
        const score = matching.length ? matchScore(product.words, matching, candidates) : 0;
        if (score === null) continue;
        base.push({ product, score });
    }

    const keyMatches = (variant: CatalogVariant, key: string, values: Set<string>) =>
        variant.options.some(option => option.dimension === key && values.has(option.code)) ||
        variant.facetValueIds.some(id => {
            const value = catalog.facetValues.get(id);
            return !!value && value.facetCode === key && values.has(value.code);
        });
    const knownKey = (key: string) =>
        facetCodes.has(key) || (OPTION_DIMENSIONS as readonly string[]).includes(key);
    const activeFilters = [...filters].filter(([key, values]) => values.size && knownKey(key));

    /** Whether a variation passes every filter except the one named (a key, `price` or `stock`). */
    const variantPasses = (variant: CatalogVariant, except?: string) => {
        if (except !== 'price') {
            if (query.priceMin != null && variant.price < query.priceMin) return false;
            if (query.priceMax != null && variant.price > query.priceMax) return false;
        }
        if (except !== 'stock' && query.inStockOnly && !variant.inStock) return false;
        return activeFilters.every(([key, values]) => key === except || keyMatches(variant, key, values));
    };

    // The results.
    const results = base.flatMap(({ product, score }) => {
        const variants = product.variants.filter(variant => variantPasses(variant));
        if (!variants.length) return [];
        return [
            {
                product,
                score,
                price: Math.min(...variants.map(variant => variant.price)),
                inStock: variants.some(variant => variant.inStock),
            },
        ];
    });

    // Counts per filter value, each ignoring its own filter.
    const filterResults: FilterResult[] = [];
    const keys = new Set<string>([...OPTION_DIMENSIONS, ...facetCodes]);
    for (const key of keys) {
        const counts = new Map<string, number>();
        const present = new Set<string>();
        for (const { product } of base) {
            const valuesHere = new Set<string>();
            const passingHere = new Set<string>();
            for (const variant of product.variants) {
                const own = variantValues(catalog, variant, key);
                for (const value of own) valuesHere.add(value);
                if (variantPasses(variant, key)) for (const value of own) passingHere.add(value);
            }
            for (const value of valuesHere) present.add(value);
            for (const value of passingHere) counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        const selected = filters.get(key) ?? new Set<string>();
        for (const value of selected) present.add(value);
        if (!present.size) continue;
        const kind: FilterResult['kind'] = (OPTION_DIMENSIONS as readonly string[]).includes(key)
            ? 'option'
            : 'facet';
        const values = [...present]
            .map(value => ({
                value,
                label: valueLabel(catalog, key, kind, value),
                count: counts.get(value) ?? 0,
                selected: selected.has(value),
            }))
            .sort((a, b) => compareValues(key, a, b));
        const facetName = kind === 'facet' ? facetNameOf(catalog, key) : '';
        filterResults.push({ key, kind, label: facetName, values });
    }

    // Price range and stock count, each ignoring its own filter.
    const prices: number[] = [];
    let inStockCount = 0;
    for (const { product } of base) {
        const forPrice = product.variants.filter(variant => variantPasses(variant, 'price'));
        prices.push(...forPrice.map(variant => variant.price));
        if (product.variants.some(variant => variant.inStock && variantPasses(variant, 'stock')))
            inStockCount++;
    }

    const sort: SearchSort =
        query.sort === 'relevance' && !slots.length
            ? 'featured'
            : (query.sort ?? (slots.length ? 'relevance' : 'featured'));
    results.sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        const byNewest = b.product.createdAt - a.product.createdAt;
        let order = 0;
        switch (sort) {
            case 'relevance':
                order = b.score - a.score || b.product.popularity - a.product.popularity || byNewest;
                break;
            case 'featured':
                order = Number(b.product.featured) - Number(a.product.featured) || byNewest;
                break;
            case 'newest':
                order = byNewest;
                break;
            case 'price-asc':
                order = a.price - b.price;
                break;
            case 'price-desc':
                order = b.price - a.price;
                break;
            case 'popular':
                order = b.product.popularity - a.product.popularity || byNewest;
                break;
        }
        return (
            order || Number(a.product.id) - Number(b.product.id) || a.product.id.localeCompare(b.product.id)
        );
    });

    const skip = Math.max(0, query.skip ?? 0);
    const take = Math.max(0, query.take ?? 24);
    return {
        total: results.length,
        productIds: results.slice(skip, skip + take).map(result => result.product.id),
        filters: filterResults,
        priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        inStockCount,
        didYouMean: didYouMean(slots, candidates),
    };
}

function variantValues(catalog: SearchCatalog, variant: CatalogVariant, key: string): string[] {
    const values = variant.options.filter(option => option.dimension === key).map(option => option.code);
    for (const id of variant.facetValueIds) {
        const value = catalog.facetValues.get(id);
        if (value && value.facetCode === key) values.push(value.code);
    }
    return values;
}

function valueLabel(catalog: SearchCatalog, key: string, kind: FilterResult['kind'], value: string): string {
    if (kind === 'option') return catalog.optionNames.get(`${key}:${value}`) ?? value;
    for (const facetValue of catalog.facetValues.values()) {
        if (facetValue.facetCode === key && facetValue.code === value) return facetValue.name;
    }
    return value;
}

function facetNameOf(catalog: SearchCatalog, key: string): string {
    for (const facetValue of catalog.facetValues.values()) {
        if (facetValue.facetCode === key) return facetValue.facetName;
    }
    return key;
}

/** Words that only matched with a typo are replaced by their closest word, e.g. "punjabi" → "panjabi". */
function didYouMean(slots: Slot[], candidates: Map<string, Map<string, Candidate>>): string | null {
    let changed = false;
    const words = slots.flatMap(slot => {
        if (slot.alternatives.length > 1) return slot.original;
        const word = slot.original[0]!;
        const options = [...(candidates.get(word)?.entries() ?? [])];
        if (
            !options.length ||
            options.some(([, candidate]) => candidate.kind === 'exact' || candidate.kind === 'prefix')
        ) {
            return [word];
        }
        const loose = options
            .filter(([, candidate]) => candidate.kind === 'loose')
            .sort((a, b) => b[1].similarity - a[1].similarity || a[0].localeCompare(b[0]));
        if (!loose.length) return [word];
        changed = true;
        return [loose[0]![0]];
    });
    return changed ? words.join(' ') : null;
}

/** Categories whose name matches every word of the query, best first (for suggestions). */
export function matchCollections(
    catalog: SearchCatalog,
    term: string,
    synonyms: string[][],
    take: number,
): CatalogCollection[] {
    const words = queryWords(term);
    if (!words.length) return [];
    const slots = buildSlots(words, synonyms);
    const collections = [...catalog.collections.values()];
    const vocabulary = [...new Set(collections.flatMap(collection => [...collection.words.keys()]))];
    const candidates = new Map<string, Map<string, Candidate>>();
    for (const slot of slots) {
        for (const alternative of slot.alternatives) {
            for (const word of alternative.words) {
                if (!candidates.has(word)) candidates.set(word, findCandidates(word, vocabulary));
            }
        }
    }
    return collections
        .map(collection => ({ collection, score: matchScore(collection.words, slots, candidates) }))
        .filter((entry): entry is { collection: CatalogCollection; score: number } => entry.score !== null)
        .sort((a, b) => b.score - a.score || a.collection.slugs.length - b.collection.slugs.length)
        .slice(0, take)
        .map(entry => entry.collection);
}

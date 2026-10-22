import {
    type CatalogCollection,
    type CatalogFacetValue,
    type CatalogProduct,
    type CatalogVariant,
    FIELD_WEIGHTS,
    type OptionDimension,
    type SearchCatalog,
    wordMap,
} from './search-engine';

/** What the search reads from the database (search.service.ts), as plain rows. */
export interface CatalogRows {
    /** Vendure's search index: one row per variation and language (enabled ones only). */
    index: Array<{
        variantId: string;
        productId: string;
        languageCode: string;
        productName: string;
        productVariantName: string;
        sku: string;
        priceWithTax: number;
        inStock: boolean;
        /** Comma-separated, as the index stores them. */
        facetValueIds: string;
        collectionIds: string;
    }>;
    products: Array<{ id: string; createdAt: Date | string; featured: boolean | null }>;
    options: Array<{
        variantId: string;
        groupCode: string;
        optionCode: string;
        languageCode: string | null;
        name: string | null;
    }>;
    /** Values of public facets, one row per translation. */
    facetValues: Array<{
        id: string;
        code: string;
        facetCode: string;
        languageCode: string | null;
        name: string | null;
        facetName: string | null;
    }>;
    collections: Array<{
        id: string;
        parentId: string | null;
        isRoot: boolean;
        isPrivate: boolean;
        languageCode: string | null;
        name: string | null;
        slug: string | null;
    }>;
    /** Units delivered recently, per product ID. */
    popularity: Map<string, number>;
}

/** Splits a TypeORM simple-array column ("1,2,3"). */
const ids = (value: string) => (value ? value.split(',').filter(Boolean) : []);

/** `<productId>:size` (phase 05), `size`, `product-size` → size; the same for colour/color. */
export function optionDimension(groupCode: string): OptionDimension | null {
    const code = groupCode.toLowerCase();
    if (/(^|[:_-])size$/.test(code)) return 'size';
    if (/(^|[:_-])colou?r$/.test(code)) return 'colour';
    return null;
}

/** The row in the request's language, else the default language, else any. */
function inLanguage<T extends { languageCode: string | null }>(
    rows: T[],
    language: string,
    fallback: string,
) {
    return (
        rows.find(row => row.languageCode === language) ??
        rows.find(row => row.languageCode === fallback) ??
        rows.find(row => row.languageCode)
    );
}

function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
        const id = key(row);
        const list = map.get(id);
        if (list) list.push(row);
        else map.set(id, [row]);
    }
    return map;
}

/**
 * The searchable catalog: every product with its variations and its words in every language
 * (name, variations, SKU, options, facet values, its categories and their parents), and the
 * labels the filters show in the request's language.
 */
export function buildCatalog(rows: CatalogRows, language: string, fallback: string): SearchCatalog {
    // Facet values.
    const facetValues = new Map<string, CatalogFacetValue>();
    const facetTexts = new Map<string, string[]>();
    for (const [id, translations] of group(rows.facetValues, row => row.id)) {
        const chosen = inLanguage(translations, language, fallback);
        const first = translations[0]!;
        facetValues.set(id, {
            id,
            code: first.code,
            facetCode: first.facetCode,
            facetName: chosen?.facetName || first.facetCode,
            name: chosen?.name || first.code,
        });
        facetTexts.set(id, translations.map(row => row.name ?? '').filter(Boolean));
    }

    // Categories: Vendure's hidden root and private collections are left out.
    const rootIds = new Set(rows.collections.filter(row => row.isRoot).map(row => row.id));
    const collections = new Map<string, CatalogCollection>();
    const collectionTexts = new Map<string, string[]>();
    const visible = rows.collections.filter(row => !row.isRoot && !row.isPrivate);
    for (const [id, translations] of group(visible, row => row.id)) {
        const chosen = inLanguage(translations, language, fallback);
        const names = translations.map(row => row.name ?? '').filter(Boolean);
        const parentId = translations[0]!.parentId;
        collections.set(id, {
            id,
            parentId: parentId && !rootIds.has(parentId) ? parentId : null,
            name: chosen?.name ?? '',
            slugs: [chosen?.slug ?? ''],
            words: wordMap(names.map(text => ({ text, weight: 1 }))),
        });
        collectionTexts.set(id, names);
    }
    /** The category and its parents, at most 10 levels (guards against a broken tree). */
    const lineage = (id: string): CatalogCollection[] => {
        const list: CatalogCollection[] = [];
        let current = collections.get(id);
        for (let depth = 0; current && depth < 10; depth++) {
            list.push(current);
            current = current.parentId ? collections.get(current.parentId) : undefined;
        }
        return list;
    };
    const ownSlug = new Map(
        [...collections.values()].map(collection => [collection.id, collection.slugs[0]!]),
    );
    for (const collection of collections.values()) {
        collection.slugs = lineage(collection.id)
            .reverse()
            .map(item => ownSlug.get(item.id)!);
    }

    // Variation options.
    const optionsByVariant = new Map<string, Array<{ dimension: OptionDimension; code: string }>>();
    const optionTexts = new Map<string, string[]>();
    const optionLabels = new Map<string, Array<{ languageCode: string | null; name: string }>>();
    for (const row of rows.options) {
        if (row.name) optionTexts.set(row.variantId, [...(optionTexts.get(row.variantId) ?? []), row.name]);
        const dimension = optionDimension(row.groupCode);
        if (!dimension) continue;
        const list = optionsByVariant.get(row.variantId) ?? [];
        if (!list.some(option => option.code === row.optionCode))
            list.push({ dimension, code: row.optionCode });
        optionsByVariant.set(row.variantId, list);
        if (row.name) {
            const key = `${dimension}:${row.optionCode}`;
            optionLabels.set(key, [
                ...(optionLabels.get(key) ?? []),
                { languageCode: row.languageCode, name: row.name },
            ]);
        }
    }
    const optionNames = new Map<string, string>();
    for (const [key, labels] of optionLabels) {
        optionNames.set(key, (inLanguage(labels, language, fallback) ?? labels[0]!).name);
    }

    // Products.
    const meta = new Map(rows.products.map(row => [row.id, row]));
    const products: CatalogProduct[] = [];
    const vocabulary = new Set<string>();
    for (const [productId, indexRows] of group(rows.index, row => row.productId)) {
        const product = meta.get(productId);
        if (!product) continue;
        const variants = new Map<string, CatalogVariant>();
        const collectionIds = new Set<string>();
        const fields: Array<{ text: string; weight: number }> = [];
        for (const row of indexRows) {
            fields.push({ text: row.productName, weight: FIELD_WEIGHTS.name });
            if (row.productVariantName !== row.productName) {
                fields.push({ text: row.productVariantName, weight: FIELD_WEIGHTS.variant });
            }
            for (const id of ids(row.collectionIds)) collectionIds.add(id);
            if (variants.has(row.variantId)) continue;
            fields.push({ text: row.sku, weight: FIELD_WEIGHTS.sku });
            for (const text of optionTexts.get(row.variantId) ?? [])
                fields.push({ text, weight: FIELD_WEIGHTS.option });
            const facetValueIds = ids(row.facetValueIds).filter(id => facetValues.has(id));
            for (const id of facetValueIds) {
                for (const text of facetTexts.get(id) ?? [])
                    fields.push({ text, weight: FIELD_WEIGHTS.facet });
            }
            variants.set(row.variantId, {
                id: row.variantId,
                price: row.priceWithTax,
                inStock: row.inStock,
                facetValueIds,
                options: optionsByVariant.get(row.variantId) ?? [],
            });
        }
        // A product in "Men › Panjabi" is found by "men" too.
        const categories = new Set([...collectionIds].flatMap(id => lineage(id).map(item => item.id)));
        for (const id of categories) {
            for (const text of collectionTexts.get(id) ?? [])
                fields.push({ text, weight: FIELD_WEIGHTS.category });
        }
        const words = wordMap(fields);
        for (const word of words.keys()) vocabulary.add(word);
        products.push({
            id: productId,
            createdAt: new Date(product.createdAt).getTime(),
            featured: !!product.featured,
            popularity: rows.popularity.get(productId) ?? 0,
            collectionIds,
            variants: [...variants.values()],
            words,
        });
    }
    return { products, vocabulary: [...vocabulary], facetValues, optionNames, collections };
}

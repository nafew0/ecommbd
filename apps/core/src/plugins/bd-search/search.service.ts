import {
    cleanSearchQuery,
    defaultSearchSettings,
    dhakaDateKey,
    isPrivateSearchTerm,
    parseSearchSettings,
    queryWords,
    type SearchSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Logger, RequestContext, SettingsStoreService, TransactionalConnection } from '@vendure/core';
import {
    BD_SEARCH_PLUGIN_OPTIONS,
    type BdSearchPluginOptions,
    loggerCtx,
    MAX_TAKE,
    MISS_LIMITS,
    SEARCH_SETTINGS_KEY,
} from './constants';
import { buildCatalog, type CatalogRows } from './catalog';
import {
    matchCollections,
    runSearch,
    type SearchCatalog,
    type SearchOutcome,
    type SearchSort,
} from './search-engine';

export interface SearchInput {
    term?: string | null;
    collectionId?: string | null;
    filters?: Array<{ key: string; values: string[] }> | null;
    /** Whole taka. */
    priceMin?: number | null;
    priceMax?: number | null;
    inStockOnly?: boolean | null;
    sort?: SearchSort | null;
    skip?: number | null;
    take?: number | null;
    recordMiss?: boolean | null;
}

export interface Suggestions {
    productIds: string[];
    collections: Array<{ id: string; name: string; slugs: string[] }>;
    didYouMean: string | null;
}

export type UpdateSearchSettingsResult =
    { settings: SearchSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** At most this many filter keys and values per key are read from a request. */
const MAX_FILTER_KEYS = 10;
const MAX_FILTER_VALUES = 20;
const POPULAR_DAYS = 90;
const POPULAR_CACHE_MS = 10 * 60 * 1000;
const SETTINGS_CACHE_MS = 30 * 1000;

/**
 * Product search for the storefront (roadmap phase 13). Reads Vendure's search index (kept up to
 * date by DefaultSearchPlugin), variation options, facets and categories, and runs the pure search
 * engine over them. Also keeps the store's synonyms and the searches that found nothing.
 */
@Injectable()
export class BdSearchService {
    private catalogs = new Map<string, { at: number; catalog: Promise<SearchCatalog> }>();
    private popular = new Map<string, { at: number; units: Promise<Map<string, number>> }>();
    private settingsCache = new Map<string, { at: number; settings: Promise<SearchSettings> }>();

    constructor(
        private connection: TransactionalConnection,
        private settingsStore: SettingsStoreService,
        @Inject(BD_SEARCH_PLUGIN_OPTIONS) private options: BdSearchPluginOptions,
    ) {}

    async search(ctx: RequestContext, input: SearchInput): Promise<SearchOutcome> {
        const term = cleanSearchQuery(input.term ?? '');
        const filters = new Map<string, Set<string>>();
        for (const filter of (input.filters ?? []).slice(0, MAX_FILTER_KEYS)) {
            const values = filter.values.slice(0, MAX_FILTER_VALUES).map(value => value.slice(0, 100));
            if (filter.key && values.length) filters.set(filter.key.slice(0, 50), new Set(values));
        }
        let priceMin = input.priceMin != null && input.priceMin >= 0 ? input.priceMin : undefined;
        let priceMax = input.priceMax != null && input.priceMax >= 0 ? input.priceMax : undefined;
        // A range typed the wrong way round is swapped.
        if (priceMin != null && priceMax != null && priceMin > priceMax)
            [priceMin, priceMax] = [priceMax, priceMin];
        const [catalog, settings] = await Promise.all([this.catalog(ctx), this.settings(ctx)]);
        const outcome = runSearch(catalog, {
            term,
            collectionId: input.collectionId ? String(input.collectionId) : undefined,
            filters,
            priceMin: priceMin != null ? priceMin * 100 : undefined,
            priceMax: priceMax != null ? priceMax * 100 : undefined,
            inStockOnly: !!input.inStockOnly,
            sort: input.sort ?? undefined,
            skip: Math.min(Math.max(0, input.skip ?? 0), 100_000),
            take: Math.min(Math.max(0, input.take ?? 24), MAX_TAKE),
            synonyms: settings.synonyms,
        });
        const unfiltered = !filters.size && priceMin == null && priceMax == null && !input.inStockOnly;
        if (input.recordMiss && term && !outcome.total && unfiltered && !input.skip && !input.collectionId) {
            await this.recordMiss(ctx, term).catch((error: unknown) =>
                Logger.warn(`Could not record a search with no results: ${String(error)}`, loggerCtx),
            );
        }
        return outcome;
    }

    async suggest(ctx: RequestContext, rawTerm: string): Promise<Suggestions> {
        const term = cleanSearchQuery(rawTerm);
        // Under 2 characters there's too little to suggest (the full search still runs).
        if ([...term.replace(/\s/g, '')].length < 2 || !queryWords(term).length) {
            return { productIds: [], collections: [], didYouMean: null };
        }
        const [catalog, settings] = await Promise.all([this.catalog(ctx), this.settings(ctx)]);
        const outcome = runSearch(catalog, { term, take: 6, synonyms: settings.synonyms });
        return {
            productIds: outcome.productIds,
            collections: matchCollections(catalog, term, settings.synonyms, 3).map(collection => ({
                id: collection.id,
                name: collection.name,
                slugs: collection.slugs,
            })),
            didYouMean: outcome.didYouMean,
        };
    }

    async settings(ctx: RequestContext): Promise<SearchSettings> {
        const key = String(ctx.channelId);
        const cached = this.settingsCache.get(key);
        if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.settings;
        const settings = this.settingsStore
            .get<SearchSettings>(ctx, SEARCH_SETTINGS_KEY)
            .then(stored => {
                const parsed = parseSearchSettings(stored ?? defaultSearchSettings());
                return parsed.ok ? parsed.value : defaultSearchSettings();
            })
            .catch((error: unknown) => {
                this.settingsCache.delete(key);
                throw error;
            });
        this.settingsCache.set(key, { at: Date.now(), settings });
        return settings;
    }

    async updateSettings(ctx: RequestContext, input: unknown): Promise<UpdateSearchSettingsResult> {
        const parsed = parseSearchSettings(input);
        if (!parsed.ok) return { settings: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, SEARCH_SETTINGS_KEY, parsed.value);
        if (!saved.result) throw new Error(`Could not save search settings: ${saved.error}`);
        this.settingsCache.delete(String(ctx.channelId));
        return { settings: parsed.value, errors: [] };
    }

    /** Counts a search with no results for today. Phone numbers and emails are never stored. */
    async recordMiss(ctx: RequestContext, term: string): Promise<void> {
        if (isPrivateSearchTerm(term)) return;
        const day = dhakaDateKey(new Date());
        // A new term is only added while today has fewer than the limit; known terms always count.
        await this.connection.rawConnection.query(
            `INSERT INTO bd_search_miss ("createdAt", "updatedAt", "channelId", term, day, count)
             SELECT now(), now(), $1::integer, $2::varchar, $3::date, 1
             WHERE EXISTS (SELECT 1 FROM bd_search_miss WHERE "channelId" = $1::integer AND term = $2::varchar AND day = $3::date)
                OR (SELECT count(*) FROM bd_search_miss WHERE "channelId" = $1::integer AND day = $3::date) < $4::integer
             ON CONFLICT ("channelId", term, day)
             DO UPDATE SET count = bd_search_miss.count + 1, "updatedAt" = now()`,
            [ctx.channelId, term.toLowerCase(), day, MISS_LIMITS.newTermsPerDay],
        );
    }

    async misses(
        ctx: RequestContext,
        days: number = MISS_LIMITS.keepDays,
        take = 100,
    ): Promise<Array<{ term: string; count: number; lastSearchedAt: Date }>> {
        const since = dhakaDateKey(new Date(Date.now() - (Math.min(Math.max(days, 1), 90) - 1) * 86_400_000));
        const rows: Array<{ term: string; count: number; lastSearchedAt: Date }> =
            await this.connection.rawConnection.query(
                `SELECT term, SUM(count)::int AS count, MAX("updatedAt") AS "lastSearchedAt"
                 FROM bd_search_miss WHERE "channelId" = $1 AND day >= $2
                 GROUP BY term ORDER BY SUM(count) DESC, MAX("updatedAt") DESC LIMIT $3`,
                [ctx.channelId, since, Math.min(Math.max(take, 1), 500)],
            );
        return rows;
    }

    /** Deletes no-result searches older than the days kept. Returns how many rows went. */
    async deleteOldMisses(): Promise<number> {
        const before = dhakaDateKey(new Date(Date.now() - MISS_LIMITS.keepDays * 86_400_000));
        const result: [unknown, number] = await this.connection.rawConnection.query(
            'DELETE FROM bd_search_miss WHERE day < $1',
            [before],
        );
        return result[1] ?? 0;
    }

    /** The catalog for this channel and language, reused for a few seconds. */
    private catalog(ctx: RequestContext): Promise<SearchCatalog> {
        const key = `${String(ctx.channelId)}:${ctx.languageCode}`;
        const ttl = this.options.catalogCacheMs ?? 3000;
        const cached = this.catalogs.get(key);
        if (cached && Date.now() - cached.at < ttl) return cached.catalog;
        const catalog = this.loadCatalog(ctx).catch((error: unknown) => {
            this.catalogs.delete(key);
            throw error;
        });
        if (ttl > 0) this.catalogs.set(key, { at: Date.now(), catalog });
        return catalog;
    }

    private async loadCatalog(ctx: RequestContext): Promise<SearchCatalog> {
        const language = ctx.languageCode as string;
        const fallback = ctx.channel.defaultLanguageCode as string;
        const query = <T>(sql: string, parameters: unknown[] = []): Promise<T[]> =>
            this.connection.rawConnection.query(sql, parameters);
        const [indexRows, productRows, optionRows, facetRows, collectionRows, popularity] = await Promise.all(
            [
                query<CatalogRows['index'][number]>(
                    `SELECT "productVariantId"::text AS "variantId", "productId"::text AS "productId", "languageCode",
                        "productName", "productVariantName", sku, "priceWithTax", "inStock", "facetValueIds", "collectionIds"
                 FROM search_index_item WHERE "channelId" = $1 AND enabled = true`,
                    [ctx.channelId],
                ),
                query<CatalogRows['products'][number]>(
                    `SELECT id::text AS id, "createdAt", "customFieldsFeatured" AS featured
                 FROM product WHERE "deletedAt" IS NULL AND enabled = true`,
                ),
                query<CatalogRows['options'][number]>(
                    `SELECT pvo."productVariantId"::text AS "variantId", g.code AS "groupCode", o.code AS "optionCode",
                        t."languageCode", t.name
                 FROM product_variant_options_product_option pvo
                 JOIN product_option o ON o.id = pvo."productOptionId" AND o."deletedAt" IS NULL
                 JOIN product_option_group g ON g.id = o."groupId"
                 LEFT JOIN product_option_translation t ON t."baseId" = o.id`,
                ),
                query<CatalogRows['facetValues'][number]>(
                    `SELECT fv.id::text AS id, fv.code, f.code AS "facetCode", fvt."languageCode", fvt.name, ft.name AS "facetName"
                 FROM facet_value fv
                 JOIN facet f ON f.id = fv."facetId" AND f."isPrivate" = false
                 LEFT JOIN facet_value_translation fvt ON fvt."baseId" = fv.id
                 LEFT JOIN facet_translation ft ON ft."baseId" = f.id AND ft."languageCode" = fvt."languageCode"`,
                ),
                query<CatalogRows['collections'][number]>(
                    `SELECT c.id::text AS id, c."parentId"::text AS "parentId", c."isRoot", c."isPrivate",
                        ct."languageCode", ct.name, ct.slug
                 FROM collection c LEFT JOIN collection_translation ct ON ct."baseId" = c.id`,
                ),
                this.popularity(ctx),
            ],
        );

        return buildCatalog(
            {
                index: indexRows,
                products: productRows,
                options: optionRows,
                facetValues: facetRows,
                collections: collectionRows,
                popularity,
            },
            language,
            fallback,
        );
    }

    /** Units in delivered orders placed in the last 90 days, per product; reused for 10 minutes. */
    private popularity(ctx: RequestContext): Promise<Map<string, number>> {
        const key = String(ctx.channelId);
        const cached = this.popular.get(key);
        if (cached && Date.now() - cached.at < POPULAR_CACHE_MS) return cached.units;
        const since = new Date(Date.now() - POPULAR_DAYS * 86_400_000);
        const units = this.connection.rawConnection
            .query(
                `SELECT pv."productId"::text AS "productId", SUM(ol.quantity)::int AS units
                 FROM order_line ol
                 JOIN "order" o ON o.id = ol."orderId"
                 JOIN product_variant pv ON pv.id = ol."productVariantId"
                 WHERE o.state = 'Delivered' AND o."orderPlacedAt" >= $1
                 GROUP BY pv."productId"`,
                [since],
            )
            .then(
                (rows: Array<{ productId: string; units: number }>) =>
                    new Map(rows.map(row => [row.productId, row.units])),
            )
            .catch((error: unknown) => {
                this.popular.delete(key);
                throw error;
            });
        this.popular.set(key, { at: Date.now(), units });
        return units;
    }

    /** Forgets cached popularity (tests, after delivering orders). */
    clearCaches() {
        this.catalogs.clear();
        this.popular.clear();
        this.settingsCache.clear();
    }
}

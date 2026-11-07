import { encodeSlug, createHttpClient, type HttpClient } from '@ecommbd/shared';
import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { ModuleRef } from '@nestjs/core';
import {
    AssetEvent,
    type BlockingEventHandlerOptions,
    Channel,
    CollectionEvent,
    CollectionModificationEvent,
    CollectionService,
    ConfigService,
    EventBus,
    FacetEvent,
    FacetValueEvent,
    GlobalSettingsEvent,
    type ID,
    idsAreEqual,
    isInspectableJobQueueStrategy,
    JobQueue,
    JobQueueService,
    Logger,
    Product,
    ProductChannelEvent,
    ProductEvent,
    ProductOptionEvent,
    ProductOptionGroupEvent,
    ProductVariant,
    ProductVariantChannelEvent,
    ProductVariantEvent,
    ProductVariantService,
    Promotion,
    PromotionEvent,
    RequestContext,
    RequestContextService,
    StockMovementEvent,
    TaxRateModificationEvent,
    TransactionalConnection,
    type VendureEvent,
} from '@vendure/core';
import Redis from 'ioredis';
import { In, IsNull, LessThanOrEqual, MoreThan, MoreThanOrEqual, type Repository } from 'typeorm';
import { collectionPath, MenuService } from '../bd-content/menu.service';
import { BdSearchService } from '../bd-search/search.service';
import { isWooImportContext, WooImportCompletedEvent } from '../woo-import/context';
import { CachePurgeRequest, CacheStockState } from './entities';
import { StorefrontChangedEvent } from './events';
import { CACHE_OPTIONS, type CachePurgeOptions } from './options';
import {
    cleanTags,
    deliveryTags,
    LISTING_TAG,
    PRICE_TAGS,
    PRODUCTS_TAG,
    productTags,
    STORE_TAG,
} from './tags';

const loggerCtx = 'CachePurge';

/**
 * Postgres advisory-lock keys (`pg_advisory_xact_lock(key, channelId)`), one per kind of work, so
 * the locks never collide with each other or with other plugins'.
 */
/** One delivery per channel at a time, across every worker process. */
const LOCK_DELIVER = 1701;
/** Scheduled rows (promotion boundaries, the import catch-up): an edit and the start-up seed take turns. */
const LOCK_SCHEDULE = 1702;

/** `boundary` of a listing follow-up that waits for the search index… */
const SETTLE = 'listing-settle';
/** …and of one whose index has caught up, waiting out bd-search's catalog cache. */
const SETTLE_READY = 'listing-settle:ready';
/** `boundary` of the purge-all that ends a WooCommerce import (or replaces it if the import dies). */
const IMPORT_CATCHUP = 'import-catchup';

/** While the search index is busy, look again this often. */
const SETTLE_RECHECK_MS = 2000;
/** Stop waiting for a busy index (a full reindex of a big catalog) after 10 minutes. */
const SETTLE_MAX_WAIT_MS = 10 * 60_000;
/** A failed delivery keeps its rows and is tried again after 5 s (not on every tick). */
const RETRY_MS = 5000;
/** How often the worker asks Varnish whether it restarted. */
const INSTANCE_CHECK_MS = 10_000;
/**
 * An import counts as running until 5 minutes after its last change: the importer renews its
 * lease every 5 minutes, and a dead import's catch-up purge goes out then.
 */
const IMPORT_QUIET_MS = 5 * 60_000;
/** The import catch-up row is pushed back at most once a minute (not on every imported record). */
const IMPORT_BUMP_MS = 60_000;
/** A delivery takes at most this many rows; the rest go out on the next tick. */
const DELIVERY_ROWS = 5000;
/** Warm-up: the home page, then up to 10 menu or category links, then up to 50 products. */
const WARM_LINKS = 10;
const WARM_PRODUCTS = 50;
/** Paths Varnish never caches (cart, checkout…): no point warming a menu link to one. */
const UNCACHED_PATH = /^\/(?:en\/|bn\/)?(?:cart|checkout|account|track|t|search)(?:\/|\?|$)/;

/**
 * Keeps the storefront's caches fresh (roadmap phase 17): Varnish's pages and the storefront's
 * data cache in Redis.
 *
 * 1. **Outbox.** Every change that the storefront shows writes a purge row in the change's own
 *    transaction (blocking event handlers run inside it), so a rolled-back change purges nothing
 *    and a committed one is never lost.
 * 2. **Delivery.** The worker (only where jobs run, every 250 ms) delivers due rows per channel: the
 *    data cache first, then a soft purge in Varnish. Rows written within the 2-second batching
 *    window go out together, so a bulk edit is one purge. A failed delivery keeps its rows.
 * 3. **Precise tags.** A product change refreshes that product's pages and the listings, not the
 *    content pages (see tags.ts). Listings get a second refresh once the search index, which
 *    the worker updates on its own, has caught up.
 * 4. **Schedules.** Promotion starts and ends are rows due at that time. Stock purges only when
 *    what a variant shows (in stock, low stock, sold out) changes.
 * 5. **Imports.** A WooCommerce import purges nothing per record; one purge-all and a warm-up
 *    follow it.
 * 6. **Warm-up.** After a purge-all or a Varnish restart, the store's top pages are requested once,
 *    through the store's public address, so they land in the cache entries shoppers use.
 */
@Injectable()
export class CachePurgeService implements OnApplicationBootstrap, OnModuleDestroy {
    private warmQueue: JobQueue<{ channelId: number }>;
    private timer?: NodeJS.Timeout;
    private ticking = false;
    private seeded = false;
    private lastInstanceCheck = 0;
    /** The Varnish instance this process saw last (used when Redis can't be asked). */
    private lastInstance: string | null = null;
    private readonly redis: Redis;
    private readonly varnish: HttpClient;

    constructor(
        private db: TransactionalConnection,
        private events: EventBus,
        private jobs: JobQueueService,
        private contexts: RequestContextService,
        private variants: ProductVariantService,
        private collections: CollectionService,
        private configService: ConfigService,
        private moduleRef: ModuleRef,
        @Inject(CACHE_OPTIONS) private options: CachePurgeOptions,
    ) {
        // Fails fast while Redis is down (no offline queue): event handlers run inside merchants'
        // transactions and must not wait for it.
        this.redis = new Redis({
            ...options.redis,
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            commandTimeout: 1000,
        });
        this.redis.on('error', () => undefined);
        // Varnish is our own, on a fixed address. No retries here: a failed delivery is retried
        // from the outbox, and no circuit breaker, which would also block the restart check.
        this.varnish = createHttpClient({
            ssrfProtection: false,
            maxRetries: 0,
            timeoutMs: 1500,
            circuitBreaker: false,
        });
    }

    private get batchMs() {
        return this.options.batchMs ?? 2000;
    }
    private get settleMs() {
        return this.options.listingSettleMs ?? 10_000;
    }
    private get listingCacheMs() {
        return this.options.listingCacheMs ?? 3000;
    }
    private get dataPrefix() {
        return `${this.options.redisKeyPrefix}:sf:`;
    }

    async onApplicationBootstrap() {
        void this.redis.connect().catch(() => undefined);
        this.warmQueue = await this.jobs.createQueue({
            name: 'storefront-cache-warm',
            // The result (the pages warmed) shows in the Dashboard's job list.
            process: job => this.warm(job.data.channelId),
        });
        this.listen();
        this.timer = setInterval(
            () =>
                void this.round().catch((error: unknown) =>
                    Logger.warn(`Cache purge round failed: ${String(error)}`, loggerCtx),
                ),
            // Often enough that a change shows within 3 seconds (2 s batching, then the purge, then
            // the re-render). One query on a small table (rows go once delivered), in one process.
            this.options.pollMs ?? 250,
        );
        this.timer.unref();
    }

    /**
     * Whether this process runs Vendure's jobs: the worker in production (server processes only
     * write purge rows), or the single process of a test server.
     */
    private runsJobs(): boolean {
        return this.jobs
            .getJobQueues()
            .some(queue => queue.name === 'storefront-cache-warm' && queue.running);
    }

    /**
     * The timer's round. Delivery, the restart check and the promotion seed run only where jobs
     * run, so in one place however many server processes there are. Several workers are fine:
     * each delivery takes a per-channel lock, and a restart is warmed by whichever worker notices
     * it first. The seed runs once, on the first round.
     */
    private async round() {
        if (!this.runsJobs()) return;
        if (!this.seeded) {
            this.seeded = true;
            await this.seedBoundaries();
        }
        await this.tick();
    }

    async onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        await this.varnish.close();
        this.redis.disconnect();
    }

    /** One blocking handler: it runs inside the publisher's transaction, before it commits. */
    private on<T extends VendureEvent>(
        id: string,
        event: BlockingEventHandlerOptions<T>['event'],
        handler: (event: T) => Promise<void>,
    ) {
        this.events.registerBlockingEventHandler<T>({ id, event, handler });
    }

    /** What each kind of change refreshes. The tags are explained in tags.ts. */
    private listen() {
        // Our own plugins (pages, menus, settings, theme, layouts, sales pages): the tags they name.
        this.on('cache-storefront-changed', [StorefrontChangedEvent], e =>
            isWooImportContext(e.ctx) ? Promise.resolve() : this.enqueue(e.ctx, e.tags, { all: e.all }),
        );

        // A product, its variants or the channels it's in: its own pages (product, sales pages,
        // sections showing it) and every listing. Variants also update the stock record, so a
        // later sale compares against what the page shows now.
        this.on<ProductEvent | ProductVariantEvent | ProductChannelEvent | ProductVariantChannelEvent>(
            'cache-products',
            [ProductEvent, ProductVariantEvent, ProductChannelEvent, ProductVariantChannelEvent],
            async e => {
                if (await this.quiet(e.ctx)) return;
                let products: ID[];
                if (e instanceof ProductEvent) products = [e.entity.id];
                else if (e instanceof ProductChannelEvent) products = [e.product.id];
                else if (e instanceof ProductVariantChannelEvent) products = [e.productVariant.productId];
                else {
                    products = e.entity.map(variant => variant.productId);
                    if (e.type !== 'deleted')
                        for (const variant of e.entity) await this.stock(e.ctx, variant.id, false);
                }
                await this.enqueue(e.ctx, [...productTags(products), LISTING_TAG], { settle: true });
            },
        );

        // A category itself (name, slug, parent, position, private): its pages, the listings, and
        // `collections` (the header's top categories when no menu is set).
        this.on<CollectionEvent>('cache-collections', [CollectionEvent], async e => {
            if (await this.quiet(e.ctx)) return;
            await this.enqueue(e.ctx, [`collection:${e.entity.id}`, LISTING_TAG, 'collections'], {
                settle: true,
            });
        });

        // A category's products changed (its filters ran). Vendure publishes this from a worker
        // job without awaiting it, so an error here must never escape: it would crash the worker.
        this.on<CollectionModificationEvent>(
            'cache-collection-contents',
            [CollectionModificationEvent],
            async e => {
                try {
                    if (await this.quiet(e.ctx)) return;
                    const products = await this.productsOf(e.ctx, e.productVariantIds);
                    await this.enqueue(e.ctx, [`collection:${e.collection.id}`, LISTING_TAG, ...products], {
                        settle: true,
                    });
                } catch (error) {
                    Logger.warn(`Could not record a category purge: ${String(error)}`, loggerCtx);
                }
            },
        );

        // Facets and options show on product pages and as listing filters; tax rates and global
        // settings (stock thresholds) change prices or stock everywhere. None says which products,
        // so every page showing a product is refreshed. All are rare.
        this.on<
            | FacetEvent
            | FacetValueEvent
            | ProductOptionEvent
            | ProductOptionGroupEvent
            | TaxRateModificationEvent
            | GlobalSettingsEvent
        >(
            'cache-catalog-wide',
            [
                FacetEvent,
                FacetValueEvent,
                ProductOptionEvent,
                ProductOptionGroupEvent,
                TaxRateModificationEvent,
                GlobalSettingsEvent,
            ],
            async e => {
                if (await this.quiet(e.ctx)) return;
                await this.enqueue(e.ctx, PRICE_TAGS, { settle: true });
            },
        );

        // An image edited (focal point, name) or deleted may be on any page. Uploads change nothing
        // until they're used, and using one is a product, category or layout change.
        this.on<AssetEvent>('cache-assets', [AssetEvent], async e => {
            if (e.type === 'created' || (await this.quiet(e.ctx))) return;
            await this.enqueue(e.ctx, [STORE_TAG]);
        });

        // Sales: only when what a variant shows changes (in stock, low stock, sold out).
        this.on<StockMovementEvent>('cache-stock', [StockMovementEvent], async e => {
            if (await this.quiet(e.ctx)) return;
            for (const id of new Set(e.stockMovements.map(movement => movement.productVariant.id)))
                await this.stock(e.ctx, id, true);
        });

        // A promotion edited now refreshes the pages showing prices; its future start and end are
        // scheduled as purges at those times (even during an import: they're schedules).
        this.on<PromotionEvent>('cache-promotions', [PromotionEvent], async e => {
            if (!(await this.quiet(e.ctx))) await this.enqueue(e.ctx, PRICE_TAGS);
            await this.scheduleBoundaries(
                e.ctx,
                Number(e.ctx.channelId),
                e.entity,
                e.type !== 'deleted' && e.entity.enabled !== false,
            );
        });

        // The end of an import (published once its search reindex has finished): one purge-all
        // and a warm-up, in place of everything it changed.
        this.on<WooImportCompletedEvent>('cache-import-complete', [WooImportCompletedEvent], async e => {
            await this.redis.del(this.importKey(e.ctx.channelId)).catch(() => undefined);
            await this.db
                .getRepository(e.ctx, CachePurgeRequest)
                .delete({ channelId: Number(e.ctx.channelId), boundary: IMPORT_CATCHUP });
            await this.enqueue(e.ctx, [STORE_TAG], { all: true });
        });
    }

    /**
     * True while a WooCommerce import runs in this channel: such changes write no purge rows.
     *
     * The importer's own changes are marked on their context (`isWooImportContext`). The jobs they
     * start (Vendure's category filters run in the worker with a fresh context) are recognised by a
     * mark in Redis that every marked change renews. If Redis can't be asked, purges go ahead:
     * extra purges are harmless, missing ones are not.
     *
     * A marked change also pushes back a scheduled purge-all, due 5 minutes after the import's last
     * change. A finished import replaces it with its own purge-all; one that dies leaves it to run,
     * so a half-imported catalog doesn't stay cached for a week.
     */
    private async quiet(ctx: RequestContext): Promise<boolean> {
        const key = this.importKey(ctx.channelId);
        if (!isWooImportContext(ctx)) return (await this.redis.exists(key).catch(() => 0)) === 1;
        await this.redis.set(key, '1', 'PX', IMPORT_QUIET_MS).catch(() => undefined);
        // At most once a minute per channel (NX: only the first in the minute gets 'OK').
        const bump = await this.redis
            .set(`${key}:bumped`, '1', 'PX', IMPORT_BUMP_MS, 'NX')
            .catch(() => 'OK' as const);
        if (bump === 'OK') {
            const repo = this.db.getRepository(ctx, CachePurgeRequest);
            const channelId = Number(ctx.channelId);
            await repo.query('SELECT pg_advisory_xact_lock($1,$2)', [LOCK_SCHEDULE, channelId]);
            await repo.delete({ channelId, boundary: IMPORT_CATCHUP });
            await repo.save(
                new CachePurgeRequest({
                    channelId,
                    tags: [STORE_TAG],
                    all: true,
                    boundary: IMPORT_CATCHUP,
                    dueAt: new Date(Date.now() + IMPORT_QUIET_MS),
                }),
            );
        }
        return true;
    }

    private importKey(channelId: ID) {
        return `${this.dataPrefix}importing:${String(channelId)}`;
    }

    /** The products of some variants, as tags (or `products` for a big change). */
    private async productsOf(ctx: RequestContext, variantIds: ID[]): Promise<string[]> {
        // A category filter run over a whole catalog: no point looking up which products, as more
        // than 50 become `products` anyway (see productTags).
        if (variantIds.length > 1000) return [PRODUCTS_TAG];
        if (!variantIds.length) return [];
        const rows: Array<{ productId: number }> = await this.db
            .getRepository(ctx, ProductVariant)
            .query('SELECT DISTINCT "productId" FROM product_variant WHERE id = ANY($1)', [
                variantIds.map(Number),
            ]);
        return productTags(rows.map(row => row.productId));
    }

    /**
     * Writes a purge to the outbox, in `ctx`'s transaction when there is one. It goes out with the
     * next batch (about `batchMs` from now). `settle` also schedules the listing follow-up.
     */
    async enqueue(ctx: RequestContext, tags: string[], options: { all?: boolean; settle?: boolean } = {}) {
        const clean = cleanTags(tags);
        if (!clean.length && !options.all) return;
        const channelId = Number(ctx.channelId);
        const repo = this.db.getRepository(ctx, CachePurgeRequest);
        await repo.save(
            new CachePurgeRequest({
                channelId,
                tags: clean,
                all: !!options.all,
                dueAt: new Date(Date.now() + this.batchMs),
            }),
        );
        if (options.settle) await this.scheduleSettle(repo, channelId);
    }

    /**
     * The listing follow-up. Vendure updates its search index in the worker after the change
     * commits, and bd-search reads that index through a few-second cache, so the first purge can
     * still render the old list. A second purge of `listing` after `listingSettleMs` (and after
     * the index is idle, see {@link settleListings}) shows the new one. One per channel per half
     * settle period, however many changes come in.
     */
    private async scheduleSettle(repo: Repository<CachePurgeRequest>, channelId: number) {
        const dueAt = Date.now() + this.settleMs;
        const pending = await repo.exists({
            where: {
                channelId,
                boundary: SETTLE,
                dueAt: MoreThanOrEqual(new Date(dueAt - this.settleMs / 2)),
            },
        });
        if (pending) return;
        await repo.save(
            new CachePurgeRequest({
                channelId,
                tags: [LISTING_TAG],
                all: false,
                boundary: SETTLE,
                dueAt: new Date(dueAt),
            }),
        );
    }

    /**
     * Records what a variant shows shoppers now (`IN_STOCK`, `LOW_STOCK` or `OUT_OF_STOCK`, from
     * the store's stock display strategy) and, with `purge`, refreshes its pages when that changed.
     * A variant seen for the first time purges once: we can't know what its cached pages show.
     */
    private async stock(ctx: RequestContext, id: ID, purge: boolean) {
        const variant = await this.db.getRepository(ctx, ProductVariant).findOneBy({ id });
        if (!variant) return;
        const saleable = await this.variants.getSaleableStockLevel(ctx, variant);
        const level = await this.configService.catalogOptions.stockDisplayStrategy.getStockLevel(
            ctx,
            variant,
            saleable,
        );
        const repo = this.db.getRepository(ctx, CacheStockState);
        const channelId = Number(ctx.channelId);
        const old = await repo.findOneBy({ channelId, variantId: Number(id) });
        // Rows from before `level` existed only knew "any stock left".
        const before = old ? (old.level ?? (old.available ? 'IN_STOCK' : 'OUT_OF_STOCK')) : null;
        // Two first sales of a variant at the same moment would both insert: an upsert keeps that
        // bookkeeping race from failing a shopper's order.
        await repo.upsert({ channelId, variantId: Number(id), available: level !== 'OUT_OF_STOCK', level }, [
            'channelId',
            'variantId',
        ]);
        if (purge && before !== level) {
            await this.enqueue(ctx, [...productTags([variant.productId]), LISTING_TAG], { settle: true });
        }
    }

    /**
     * A promotion's future start and end, as purges scheduled for those times (Vendure has no
     * "promotion started" event). Rows already due are left alone: a boundary that passed while
     * the worker was down is still owed its purge, and the next tick delivers it.
     */
    private async scheduleBoundaries(
        ctx: RequestContext,
        channelId: number,
        promotion: Promotion,
        active: boolean,
    ) {
        const repo = this.db.getRepository(ctx, CachePurgeRequest);
        await repo.query('SELECT pg_advisory_xact_lock($1,$2)', [LOCK_SCHEDULE, channelId]);
        const boundary = `promotion:${promotion.id}`;
        const now = new Date();
        await repo.delete({ channelId, boundary, dueAt: MoreThan(now) });
        if (!active) return;
        for (const date of [promotion.startsAt, promotion.endsAt]) {
            if (!date || new Date(date) <= now) continue;
            await repo.save(
                new CachePurgeRequest({
                    channelId,
                    boundary,
                    tags: PRICE_TAGS,
                    all: false,
                    dueAt: new Date(date),
                }),
            );
        }
    }

    /**
     * At worker start: schedules every enabled promotion's future start and end, for stores from
     * before phase 17 and in case a row was lost. It purges nothing, so a deploy or restart leaves
     * the cache alone.
     */
    async seedBoundaries() {
        for (const channel of await this.db.rawConnection.getRepository(Channel).find()) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            await this.db.withTransaction(ctx, async tx => {
                const promotions = await this.db.getRepository(tx, Promotion).find({
                    where: { enabled: true, deletedAt: IsNull() },
                    relations: { channels: true },
                });
                for (const promotion of promotions) {
                    if (promotion.channels.some(c => idsAreEqual(c.id, channel.id)))
                        await this.scheduleBoundaries(tx, Number(channel.id), promotion, true);
                }
            });
        }
    }

    /** The worker's round (every 250 ms): deliver what is due, and notice a Varnish restart. */
    async tick() {
        if (this.ticking) return;
        this.ticking = true;
        try {
            const due: Array<{ channelId: number }> = await this.db.rawConnection.query(
                'SELECT DISTINCT "channelId" FROM cache_purge_request WHERE "dueAt" <= $1',
                [new Date()],
            );
            for (const { channelId } of due) {
                await this.deliver(Number(channelId)).catch((error: unknown) =>
                    Logger.warn(`Cache purge failed, trying again in 5 seconds: ${String(error)}`, loggerCtx),
                );
            }
            await this.checkVarnishRestart();
        } finally {
            this.ticking = false;
        }
    }

    /**
     * Delivers a channel's due purges in one go: every ordinary row (those still inside their
     * batching window too) and the scheduled ones whose time has come. The data cache is cleared
     * before Varnish, so a page Varnish re-renders can't read old data back in. Rows are deleted
     * only once Varnish has accepted the purge.
     */
    async deliver(channelId: number) {
        let warm = false;
        await this.db.rawConnection
            .transaction(async manager => {
                // Another worker delivering this channel right now: leave it to that one.
                const [lock] = await manager.query('SELECT pg_try_advisory_xact_lock($1,$2) AS locked', [
                    LOCK_DELIVER,
                    channelId,
                ]);
                if (!lock.locked) return;
                const repo = manager.getRepository(CachePurgeRequest);
                const now = new Date();
                await this.settleListings(repo, channelId, now);
                if (!(await repo.exists({ where: { channelId, dueAt: LessThanOrEqual(now) } }))) return;
                const rows = await repo.find({
                    where: [
                        { channelId, boundary: IsNull() },
                        { channelId, dueAt: LessThanOrEqual(now) },
                    ],
                    order: { id: 'ASC' },
                    take: DELIVERY_ROWS,
                });
                if (!rows.length) return;
                const all = rows.some(row => row.all);
                const delivery = deliveryTags(
                    this.options.storeId,
                    [...new Set(rows.flatMap(row => row.tags))],
                    all,
                );
                await this.invalidateData(delivery.dataTags);
                if (this.options.purgeUrl) await this.purgeVarnish(delivery.header);
                await repo.delete({ id: In(rows.map(row => row.id)) });
                warm = all;
            })
            .catch(async error => {
                await this.db.rawConnection.query(
                    'UPDATE cache_purge_request SET "dueAt"=$1 WHERE "channelId"=$2 AND "dueAt" <= $3',
                    [new Date(Date.now() + RETRY_MS), channelId, new Date()],
                );
                throw error;
            });
        if (warm) await this.queueWarmUp(channelId);
    }

    /**
     * Due listing follow-ups: while Vendure's search index has updates queued or running, look
     * again in 2 seconds. Once it's idle, wait out bd-search's per-process catalog cache (plus a
     * second), so every process reads the new index when the refresh renders.
     */
    private async settleListings(repo: Repository<CachePurgeRequest>, channelId: number, now: Date) {
        const due = await repo.find({ where: { channelId, boundary: SETTLE, dueAt: LessThanOrEqual(now) } });
        if (!due.length) return;
        const busy = await this.searchIndexBusy();
        for (const row of due) {
            const waited = now.getTime() - row.createdAt.getTime();
            if (busy && waited < SETTLE_MAX_WAIT_MS) {
                await repo.update(row.id, { dueAt: new Date(now.getTime() + SETTLE_RECHECK_MS) });
            } else {
                await repo.update(row.id, {
                    boundary: SETTLE_READY,
                    dueAt: new Date(now.getTime() + this.listingCacheMs + 1000),
                });
            }
        }
    }

    /** Whether Vendure's search index still has updates waiting or running, in any worker. */
    private async searchIndexBusy(): Promise<boolean> {
        const strategy = this.configService.jobQueueOptions.jobQueueStrategy;
        if (!isInspectableJobQueueStrategy(strategy)) return false;
        try {
            const jobs = await strategy.findMany({
                filter: { queueName: { eq: 'update-search-index' }, isSettled: { eq: false } },
                take: 1,
            });
            return jobs.totalItems > 0;
        } catch {
            // Can't tell: don't hold the refresh back.
            return false;
        }
    }

    /**
     * Clears the storefront's data cache in Redis for these tags. One script, so it's atomic:
     * the generation counter goes up first, which stops a render that started before this purge
     * from writing its old data back (see apps/storefront/src/lib/cache.ts). Every storefront
     * process hears the tags on the `purge` channel and drops its own copies.
     */
    async invalidateData(tags: string[]) {
        await this.redis.eval(
            `
            redis.call('INCR', KEYS[1])
            for _, tag in ipairs(ARGV) do
                local key = KEYS[2] .. 'tag:' .. tag
                for _, name in ipairs(redis.call('SMEMBERS', key)) do redis.call('DEL', KEYS[2] .. 'data:' .. name) end
                redis.call('DEL', key)
            end
            redis.call('PUBLISH', KEYS[2] .. 'purge', table.concat(ARGV, ','))
            return 1
            `,
            2,
            `${this.dataPrefix}generation`,
            this.dataPrefix,
            ...tags,
        );
    }

    /** One soft purge in Varnish: the old pages stay available (grace) while new ones render. */
    private async purgeVarnish(header: string) {
        const response = await this.varnish.request(this.options.purgeUrl!, {
            method: 'PURGE',
            headers: { 'X-Purge-Token': this.options.purgeSecret!, 'X-Purge-Tags': header },
        });
        if (response.status !== 200) throw new Error(`Varnish refused the purge (HTTP ${response.status})`);
    }

    /**
     * Every 10 seconds: asks Varnish's purge listener which instance is running (a random ID it
     * picks when it starts). A new ID means a restart with an empty cache, so the top pages are
     * warmed once. The last ID seen is kept in Redis, so a core restart, a deploy or a second
     * worker doesn't warm again. Only with warm-up on.
     */
    private async checkVarnishRestart() {
        if (!this.options.warmUp || !this.options.purgeUrl) return;
        if (Date.now() - this.lastInstanceCheck < INSTANCE_CHECK_MS) return;
        this.lastInstanceCheck = Date.now();
        const response = await this.varnish
            .request(this.options.purgeUrl, { headers: { 'X-Purge-Token': this.options.purgeSecret! } })
            .catch(() => null);
        const instance = response?.status === 200 ? response.headers.get('x-cache-instance') : null;
        if (!instance) return;
        let previous: string | null;
        try {
            // SET … GET is atomic: of several workers noticing the same restart, one sees the old ID.
            previous = (await this.redis.set(`${this.dataPrefix}varnish-instance`, instance, 'GET')) as
                string | null;
        } catch {
            // Redis down: compare with what this process saw. Its first sighting warms nothing.
            previous = this.lastInstance ?? instance;
        }
        this.lastInstance = instance;
        if (previous === instance) return;
        Logger.info('Varnish restarted: warming the top pages', loggerCtx);
        for (const channel of await this.db.rawConnection.getRepository(Channel).find())
            await this.queueWarmUp(Number(channel.id));
    }

    private async queueWarmUp(channelId: number) {
        if (this.options.warmUp && this.options.storefrontUrl)
            await this.warmQueue.add({ channelId }, { retries: 1 });
    }

    /**
     * Requests the store's top pages through its public address, one at a time, so each lands in
     * the cache entry a shopper's request uses (Varnish's key includes the Host). In the default
     * language. Returns the paths that answered 200.
     *
     * The pages: the home page; the header menu's links in menu order (or, without a menu, the top
     * categories in their order, as the header shows them); then the 50 best-selling products
     * (units in delivered orders over 90 days, newest first among equals, from bd-search). Only
     * enabled, visible, not deleted products: bd-search reads the search index.
     */
    async warm(channelId: ID): Promise<{ warmed: string[] }> {
        const base = this.options.storefrontUrl;
        if (!this.options.warmUp || !base) return { warmed: [] };
        const channel = await this.db.rawConnection.getRepository(Channel).findOneByOrFail({ id: channelId });
        const ctx = await this.contexts.create({ apiType: 'shop', channelOrToken: channel });
        // A failing choice (search down, a broken menu) still leaves the rest to warm.
        const pick = (choose: () => Promise<string[]>, what: string) =>
            choose().catch((error: unknown) => {
                Logger.warn(`Warm-up skipped the ${what}: ${String(error)}`, loggerCtx);
                return [];
            });
        const links = await pick(() => this.topLinks(ctx), 'menu and categories');
        const products = await pick(() => this.topProducts(ctx), 'best-selling products');
        const paths = [...new Set(['/', ...links, ...products])];
        const client = createHttpClient({
            ssrfProtection: false,
            maxRetries: 0,
            maxRedirects: 0,
            timeoutMs: 5000,
            circuitBreaker: false,
        });
        const warmed: string[] = [];
        try {
            for (const path of paths) {
                const response = await client.request(new URL(path, base)).catch(() => null);
                if (response?.status === 200) warmed.push(path);
            }
        } finally {
            await client.close();
        }
        Logger.info(`Warmed ${warmed.length} of ${paths.length} storefront pages`, loggerCtx);
        return { warmed };
    }

    /** The header menu's store links (with their sub-links), or the top categories without a menu. */
    private async topLinks(ctx: RequestContext): Promise<string[]> {
        const menus = await this.moduleRef.get(MenuService, { strict: false }).resolve(ctx);
        const links = menus.header.flatMap(link => [link.url, ...link.children.map(child => child.url)]);
        const local = links.filter(
            url => url.startsWith('/') && !url.startsWith('//') && !UNCACHED_PATH.test(url),
        );
        if (menus.header.length) return local.slice(0, WARM_LINKS);
        const { items } = await this.collections.findAll(ctx, {
            topLevelOnly: true,
            filter: { isPrivate: { eq: false } },
            sort: { position: SortOrder.ASC },
            take: WARM_LINKS,
        });
        return Promise.all(items.map(collection => collectionPath(ctx, this.collections, collection)));
    }

    /** The best-selling products' pages, from bd-search's "popular" order. */
    private async topProducts(ctx: RequestContext): Promise<string[]> {
        const search = this.moduleRef.get(BdSearchService, { strict: false });
        // bd-search answers at most 48 at a time (a page of results), so this may take two.
        const productIds: string[] = [];
        while (productIds.length < WARM_PRODUCTS) {
            const page = await search.search(ctx, {
                sort: 'popular',
                skip: productIds.length,
                take: WARM_PRODUCTS - productIds.length,
            });
            productIds.push(...page.productIds);
            if (!page.productIds.length || productIds.length >= page.total) break;
        }
        if (!productIds.length) return [];
        const products = await this.db.getRepository(ctx, Product).find({
            where: { id: In(productIds) },
            relations: { translations: true },
        });
        const language = ctx.channel.defaultLanguageCode;
        return productIds.flatMap(id => {
            const product = products.find(candidate => idsAreEqual(candidate.id, id));
            const slug =
                product?.translations.find(t => t.languageCode === language)?.slug ??
                product?.translations[0]?.slug;
            return slug ? [`/product/${encodeSlug(slug)}/`] : [];
        });
    }
}

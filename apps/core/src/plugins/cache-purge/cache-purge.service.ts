import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
    Channel,
    EventBus,
    JobQueue,
    JobQueueService,
    Logger,
    Product,
    Collection,
    ProductVariant,
    ProductVariantService,
    CollectionService,
    ProductEvent,
    ProductVariantEvent,
    CollectionEvent,
    FacetEvent,
    FacetValueEvent,
    PromotionEvent,
    Promotion,
    StockMovementEvent,
    AssetEvent,
    GlobalSettingsEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createHttpClient } from '@ecommbd/shared';
import Redis from 'ioredis';
import { In, IsNull, Not, LessThanOrEqual } from 'typeorm';
import { CACHE_OPTIONS, CachePurgeOptions } from './options';
import { CachePurgeRequest, CacheStockState } from './entities';
import { StorefrontChangedEvent } from './events';
import { isWooImportContext, WooImportCompletedEvent } from '../woo-import/context';

@Injectable()
export class CachePurgeService implements OnApplicationBootstrap, OnModuleDestroy {
    private queue: JobQueue<{ channelId: number }>;
    private warmQueue: JobQueue<{ channelId: number }>;
    private timer?: NodeJS.Timeout;
    private running = false;
    private redis: Redis;
    private lastHealth = 0;
    private wasHealthy: boolean | undefined;
    private lastInstance: string | null = null;
    constructor(
        private db: TransactionalConnection,
        private events: EventBus,
        private jobs: JobQueueService,
        private contexts: RequestContextService,
        private variants: ProductVariantService,
        private collections: CollectionService,
        @Inject(CACHE_OPTIONS) private options: CachePurgeOptions,
    ) {
        this.redis = new Redis({
            ...options.redis,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            commandTimeout: 1000,
        });
        this.redis.on('error', () => undefined);
    }
    async onApplicationBootstrap() {
        this.queue = await this.jobs.createQueue({
            name: 'storefront-cache-purge',
            process: job => this.deliver(job.data.channelId),
        });
        this.warmQueue = await this.jobs.createQueue({
            name: 'storefront-cache-warm',
            process: job => this.warm(job.data.channelId),
        });
        this.events.registerBlockingEventHandler({
            id: 'cache-custom-outbox',
            event: StorefrontChangedEvent,
            handler: e =>
                isWooImportContext(e.ctx) ? Promise.resolve() : this.enqueue(e.ctx, e.tags, e.all),
        });
        this.events.registerBlockingEventHandler<
            | ProductEvent
            | ProductVariantEvent
            | CollectionEvent
            | FacetEvent
            | FacetValueEvent
            | AssetEvent
            | GlobalSettingsEvent
        >({
            id: 'cache-catalog-outbox',
            event: [
                ProductEvent,
                ProductVariantEvent,
                CollectionEvent,
                FacetEvent,
                FacetValueEvent,
                AssetEvent,
                GlobalSettingsEvent,
            ],
            handler: async e => {
                if (isWooImportContext(e.ctx)) return;
                if (e instanceof ProductVariantEvent) {
                    for (const v of e.entity) if (e.type !== 'deleted') await this.stock(e.ctx, v.id, false);
                }
                await this.enqueue(e.ctx, ['catalog', 'collections', 'menus', 'layouts', 'sales-pages']);
            },
        });
        this.events.registerBlockingEventHandler({
            id: 'cache-stock-outbox',
            event: StockMovementEvent,
            handler: async e => {
                if (isWooImportContext(e.ctx)) return;
                for (const id of new Set(e.stockMovements.map(m => m.productVariant.id)))
                    await this.stock(e.ctx, id, true);
            },
        });
        this.events.registerBlockingEventHandler({
            id: 'cache-promotion-boundaries',
            event: PromotionEvent,
            handler: async e => {
                if (!isWooImportContext(e.ctx)) await this.enqueue(e.ctx, ['catalog', 'sales-pages']);
                const repo = this.db.getRepository(e.ctx, CachePurgeRequest);
                await repo.query('SELECT pg_advisory_xact_lock($1,$2)', [1702, Number(e.ctx.channelId)]);
                await repo.delete({
                    channelId: Number(e.ctx.channelId),
                    boundary: `promotion:${e.entity.id}`,
                });
                if (e.type !== 'deleted' && e.entity.enabled !== false)
                    for (const date of [e.entity.startsAt, e.entity.endsAt]) {
                        if (date && new Date(date) > new Date())
                            await repo.save(
                                new CachePurgeRequest({
                                    channelId: Number(e.ctx.channelId),
                                    boundary: `promotion:${e.entity.id}`,
                                    tags: ['catalog', 'sales-pages'],
                                    all: false,
                                    dueAt: new Date(date),
                                }),
                            );
                    }
            },
        });
        this.events.registerBlockingEventHandler({
            id: 'cache-import-complete',
            event: WooImportCompletedEvent,
            handler: e => this.enqueue(e.ctx, ['*'], true),
        });
        this.timer = setInterval(
            () => void this.tick().catch(() => Logger.warn('Cache invalidation will retry', 'CachePurge')),
            this.options.pollMs ?? 250,
        );
        this.timer.unref();
        await this.seedBoundaries();
    }
    /** Existing stores and missed boundaries during downtime need a refresh after deployment. */
    async seedBoundaries() {
        for (const channel of await this.db.rawConnection.getRepository(Channel).find()) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            await this.db.withTransaction(ctx, async tx => {
                const repo = this.db.getRepository(tx, CachePurgeRequest);
                await repo.query('SELECT pg_advisory_xact_lock($1,$2)', [1702, Number(channel.id)]);
                await repo.delete({ channelId: Number(channel.id), boundary: Not(IsNull()) });
                const promotions = await this.db
                    .getRepository(tx, Promotion)
                    .find({ where: { enabled: true }, relations: { channels: true } });
                for (const promo of promotions.filter(p => p.channels.some(c => c.id === channel.id))) {
                    for (const date of [promo.startsAt, promo.endsAt])
                        if (date && new Date(date) > new Date())
                            await repo.save(
                                new CachePurgeRequest({
                                    channelId: Number(channel.id),
                                    boundary: `promotion:${promo.id}`,
                                    tags: ['catalog', 'sales-pages'],
                                    all: false,
                                    dueAt: new Date(date),
                                }),
                            );
                }
                await this.enqueue(tx, ['*'], true);
            });
        }
    }
    async enqueue(ctx: RequestContext, tags: string[], all = false) {
        const safe = [...new Set(tags.filter(t => /^[a-zA-Z0-9:_*-]{1,80}$/.test(t)))].slice(0, 100);
        if (!safe.length && !all) return;
        await this.db.getRepository(ctx, CachePurgeRequest).save(
            new CachePurgeRequest({
                channelId: Number(ctx.channelId),
                tags: safe,
                all,
                dueAt: new Date(Date.now() + (this.options.batchMs ?? 2000)),
            }),
        );
    }
    private async stock(ctx: RequestContext, id: string | number, purge: boolean) {
        const variant = await this.db.getRepository(ctx, ProductVariant).findOneBy({ id });
        if (!variant) return;
        const available = (await this.variants.getSaleableStockLevel(ctx, variant)) > 0;
        const repo = this.db.getRepository(ctx, CacheStockState);
        const old = await repo.findOneBy({ channelId: Number(ctx.channelId), variantId: Number(id) });
        // Existing stores can receive concurrent first stock events before a state row exists.
        // An atomic upsert keeps that bookkeeping race from rejecting a shopper's order.
        await repo.upsert(
            {
                channelId: Number(ctx.channelId),
                variantId: Number(id),
                available,
            },
            ['channelId', 'variantId'],
        );
        if (purge && (!old || old.available !== available))
            await this.enqueue(ctx, ['catalog', 'sales-pages']);
    }
    async tick() {
        if (this.running) return;
        this.running = true;
        try {
            const rows = await this.db.rawConnection.getRepository(CachePurgeRequest).find({
                where: { dueAt: LessThanOrEqual(new Date()) },
                take: 1000,
                order: { id: 'ASC' },
            });
            for (const channelId of new Set(rows.map(r => r.channelId))) {
                await this.queue.add({ channelId }, { retries: 5 });
            }
            if (this.options.warmUrl && Date.now() - this.lastHealth > 30000) {
                this.lastHealth = Date.now();
                const client = createHttpClient({ ssrfProtection: false, maxRetries: 0, timeoutMs: 1500 });
                const health = await client
                    .request(new URL('/health', this.options.warmUrl))
                    .catch(() => null)
                    .finally(() => client.close());
                const healthy = health?.status === 200;
                const instance = health?.headers.get('x-cache-instance') ?? null;
                if (healthy && (this.wasHealthy !== true || instance !== this.lastInstance))
                    for (const channel of await this.db.rawConnection.getRepository(Channel).find())
                        await this.warmQueue.add({ channelId: Number(channel.id) }, { retries: 1 });
                this.wasHealthy = healthy;
                this.lastInstance = instance;
            }
        } finally {
            this.running = false;
        }
    }
    async deliver(channelId: number) {
        let all = false;
        await this.db.rawConnection
            .transaction(async manager => {
                const [lock] = await manager.query('SELECT pg_try_advisory_xact_lock($1,$2) AS locked', [
                    1701,
                    channelId,
                ]);
                if (!lock.locked) return;
                const repo = manager.getRepository(CachePurgeRequest);
                if (!(await repo.exists({ where: { channelId, dueAt: LessThanOrEqual(new Date()) } })))
                    return;
                const rows = await repo.find({
                    where: [
                        { channelId, boundary: IsNull() },
                        { channelId, dueAt: LessThanOrEqual(new Date()) },
                    ],
                    take: 5000,
                });
                if (!rows.length) return;
                all = rows.some(r => r.all);
                let tags = all ? ['*'] : [...new Set(rows.flatMap(r => r.tags))];
                if (tags.map(t => `${this.options.storeId}:${t}`).join(' ').length > 5500) {
                    all = true;
                    tags = ['*'];
                }
                await this.invalidateData(tags);
                if (this.options.purgeUrl) {
                    const client = createHttpClient({
                        ssrfProtection: false,
                        maxRetries: 0,
                        timeoutMs: 1500,
                    });
                    try {
                        const response = await client.request(this.options.purgeUrl, {
                            method: 'PURGE',
                            headers: {
                                'X-Purge-Token': this.options.purgeSecret!,
                                'X-Purge-Tags': (all
                                    ? [`${this.options.storeId}:store`]
                                    : tags.map(t => `${this.options.storeId}:${t}`)
                                ).join(' '),
                            },
                        });
                        if (response.status !== 200) throw new Error('CACHE_PURGE_REFUSED');
                    } finally {
                        await client.close();
                    }
                }
                await repo.delete({ id: In(rows.map(r => r.id)) });
            })
            .catch(async error => {
                await this.db.rawConnection.query(
                    'UPDATE cache_purge_request SET "dueAt"=$1 WHERE "channelId"=$2 AND "dueAt" <= $3',
                    [new Date(Date.now() + 5000), channelId, new Date()],
                );
                throw error;
            });
        if (all) await this.warmQueue.add({ channelId }, { retries: 1 });
    }
    async invalidateData(tags: string[]) {
        const prefix = `${this.options.redisKeyPrefix}:sf:`;
        // Atomic generation change prevents an in-flight old render from refilling the cache.
        await this.redis.eval(
            `
            redis.call('INCR',KEYS[1]);
            for _,tag in ipairs(ARGV) do
                local key=KEYS[2]..'tag:'..tag;
                for _,name in ipairs(redis.call('SMEMBERS',key)) do redis.call('DEL',KEYS[2]..'data:'..name); end
                redis.call('DEL',key);
            end
            redis.call('PUBLISH',KEYS[2]..'purge',table.concat(ARGV,',')); return 1;
        `,
            2,
            `${prefix}generation`,
            prefix,
            ...tags,
        );
    }
    async warm(channelId: string | number) {
        if (!this.options.warmUrl) return 0;
        const channel = await this.db.rawConnection.getRepository(Channel).findOneByOrFail({ id: channelId });
        const ctx = await this.contexts.create({ apiType: 'shop', channelOrToken: channel });
        const products = await this.db.getRepository(ctx, Product).find({
            where: { enabled: true },
            relations: { channels: true, translations: true },
            take: 50,
            order: { id: 'DESC' },
        });
        const collections = await this.db.getRepository(ctx, Collection).find({
            where: { isRoot: false, isPrivate: false },
            relations: { channels: true, translations: true },
            take: 10,
        });
        const slug = (p: Product | Collection) =>
            p.translations.find(t => t.languageCode === ctx.channel.defaultLanguageCode)?.slug ??
            p.translations[0]?.slug ??
            '';
        const encode = (value: string) => encodeURIComponent(value.normalize('NFC').toLowerCase());
        const categoryPaths = await Promise.all(
            collections
                .filter(p => p.channels.some(c => c.id === ctx.channelId))
                .map(async p => {
                    const crumbs = await this.collections.getBreadcrumbs(ctx, p);
                    return `/product-category/${crumbs
                        .filter(c => c.slug && c.slug !== '__root_collection__')
                        .map(c => encode(c.slug))
                        .join('/')}/`;
                }),
        );
        const paths = [
            '/',
            ...products
                .filter(p => p.channels.some(c => c.id === ctx.channelId))
                .map(p => `/product/${encode(slug(p))}/`),
            ...categoryPaths,
        ];
        let count = 0;
        const client = createHttpClient({
            ssrfProtection: false,
            maxRetries: 0,
            maxRedirects: 0,
            timeoutMs: 2000,
        });
        try {
            for (const path of paths.slice(0, 61)) {
                const response = await client.request(new URL(path, this.options.warmUrl)).catch(() => null);
                if (response?.status === 200) count++;
            }
        } finally {
            await client.close();
        }
        return count;
    }
    async onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        this.redis.disconnect();
    }
}

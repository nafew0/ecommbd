import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import { dhakaDateKey } from '@ecommbd/shared';
import {
    Channel,
    Collection,
    CollectionModificationEvent,
    DefaultSearchPlugin,
    EventBus,
    Product,
    ProductVariant,
    Promotion,
    PromotionEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import gql from 'graphql-tag';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MenuService } from '../../src/plugins/bd-content/menu.service';
import { CachePurgeService } from '../../src/plugins/cache-purge/cache-purge.service';
import { CachePurgeRequest, CacheStockState, CacheVitalSample } from '../../src/plugins/cache-purge/entities';
import { StorefrontChangedEvent } from '../../src/plugins/cache-purge/events';
import { VitalsService } from '../../src/plugins/cache-purge/vitals';
import { markWooImportContext, WooImportCompletedEvent } from '../../src/plugins/woo-import/context';
import { placePhoneOrder } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

/**
 * The storefront cache's core side (roadmap phase 17), against a stand-in for Varnish's purge
 * listener (records each purge's tags, answers with an instance ID) and a stand-in for the public
 * storefront (records warm-up requests). The worker's timer doesn't run in tests: each test
 * delivers by calling the service.
 */

registerInitializer('postgres', new PostgresInitializer());
const PORT = 3077;
const PURGE_PORT = 3078;
const SHOP_PORT = 3079;
const SHOP_URL = `http://127.0.0.1:${SHOP_PORT}`;
const config = createTestConfig(
    PORT,
    {},
    {
        cacheStoreId: 'test17',
        cachePurgeUrl: `http://127.0.0.1:${PURGE_PORT}/`,
        cachePurgeSecret: 'a'.repeat(64),
        cacheWarmUp: true,
        // The public storefront here is the stand-in below.
        storefrontUrl: SHOP_URL,
        cacheBatchMs: 0,
        cachePollMs: 3_600_000,
    },
);
// Listings and the warm-up's best sellers read Vendure's search index, as in vendure-config.ts.
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }));
const { server, adminClient, shopClient } = createTestEnvironment(config);

let purgeEndpoint: Server, shop: Server, db: TransactionalConnection, service: CachePurgeService;
let ctx: RequestContext;
let accepted = true;
let instance = 'varnish-start-1';
/** `X-Purge-Tags` of each purge Varnish accepted. */
const calls: string[] = [];
/** Warm-up requests the public storefront received. */
const warmRequests: Array<{ path: string; headers: IncomingHttpHeaders }> = [];

const UPDATE_PRODUCT = gql`
    mutation ($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;
const UPDATE_VARIANTS = gql`
    mutation ($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`;
const CREATE_COLLECTION = gql`
    mutation ($input: CreateCollectionInput!) {
        createCollection(input: $input) {
            id
        }
    }
`;
const DAILY_VITALS = gql`
    {
        cacheDailyVitals
    }
`;

beforeAll(async () => {
    purgeEndpoint = createServer((req, res) => {
        if (req.method === 'PURGE' && accepted) calls.push(String(req.headers['x-purge-tags']));
        res.writeHead(accepted ? 200 : 503, { 'x-cache-instance': instance });
        res.end();
    });
    shop = createServer((req, res) => {
        warmRequests.push({ path: req.url ?? '', headers: req.headers });
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<p>page</p>');
    });
    await new Promise<void>(resolve => purgeEndpoint.listen(PURGE_PORT, resolve));
    await new Promise<void>(resolve => shop.listen(SHOP_PORT, resolve));
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 0,
    });
    await adminClient.asSuperAdmin();
    await addMigrationOnlyObjects(server);
    db = server.app.get(TransactionalConnection);
    service = server.app.get(CachePurgeService);
    const user = await db.rawConnection
        .getRepository(User)
        .findOneOrFail({ where: { identifier: 'superadmin' }, relations: { roles: { channels: true } } });
    ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
}, 120_000);

afterAll(async () => {
    await server.destroy();
    await new Promise<void>(resolve => purgeEndpoint.close(() => resolve()));
    await new Promise<void>(resolve => shop.close(() => resolve()));
});

const pending = () => db.rawConnection.getRepository(CachePurgeRequest);
const channelId = () => Number(ctx.channelId);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const publish = (event: object) => server.app.get(EventBus).publish(event as never);

/** The service's private steps the tests watch. */
interface Internals {
    searchIndexBusy(): Promise<boolean>;
    queueWarmUp(channelId: number): Promise<void>;
    lastInstanceCheck: number;
}
const internals = () => service as unknown as Internals;

async function clear() {
    await pending().clear();
    calls.length = 0;
}

/** Ordinary rows only (not the scheduled ones). */
async function immediateRows() {
    return (await pending().find()).filter(row => row.boundary === null);
}

/** Makes every listing follow-up due, then delivers, until the follow-up's purge goes out. */
async function deliverListingFollowUp() {
    for (let round = 0; round < 20; round++) {
        await pending()
            .createQueryBuilder()
            .update()
            .set({ dueAt: new Date(0) })
            .where('boundary LIKE :settle', { settle: 'listing-settle%' })
            .execute();
        await service.deliver(channelId());
        if (calls.includes('test17:listing')) return;
        await sleep(200);
    }
    throw new Error('The listing follow-up was never delivered');
}

describe('the outbox', () => {
    it('writes a purge in the change’s transaction; a rolled-back change writes none', async () => {
        await clear();
        await expect(
            db.withTransaction(ctx, async tx => {
                await publish(new StorefrontChangedEvent(tx, ['menus']));
                throw new Error('rollback');
            }),
        ).rejects.toThrow('rollback');
        expect(await pending().count()).toBe(0);
    });

    it('batches changes into one purge with the store’s prefix, delivered once', async () => {
        await clear();
        await service.enqueue(ctx, ['listing', 'menus']);
        await service.enqueue(ctx, ['listing']);
        await service.deliver(channelId());
        expect(calls).toEqual(['test17:listing test17:menus']);
        expect(await pending().count()).toBe(0);
        await service.deliver(channelId());
        expect(calls).toHaveLength(1);
    });

    it('keeps a refused purge and tries it again', async () => {
        await clear();
        await service.enqueue(ctx, ['listing']);
        accepted = false;
        await expect(service.deliver(channelId())).rejects.toThrow();
        expect(await pending().count()).toBe(1);
        accepted = true;
        await pending()
            .createQueryBuilder()
            .update()
            .set({ dueAt: new Date(0) })
            .execute();
        await service.deliver(channelId());
        expect(calls).toEqual(['test17:listing']);
        expect(await pending().count()).toBe(0);
    });
});

describe('what a change purges', () => {
    it('a product edit purges that product and the listings, not content pages', async () => {
        await clear();
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', translations: [{ languageCode: 'en', name: 'Cotton Panjabi (edited)' }] },
        });
        await service.deliver(channelId());
        expect(calls).toHaveLength(1);
        const tags = calls[0]!.split(' ');
        expect(tags).toEqual(expect.arrayContaining(['test17:product:1', 'test17:listing']));
        // Content pages carry `pages`, `type:page` and the site-wide tags: none of them is purged.
        for (const tag of ['store', 'pages', 'type:page', 'settings', 'menus'])
            expect(tags).not.toContain(`test17:${tag}`);
    });

    it('refreshes the listings again once the search index has caught up', async () => {
        // Still waiting from the edit above: one follow-up row.
        const followUps = await pending().findBy({ boundary: 'listing-settle' });
        expect(followUps).toHaveLength(1);
        expect(followUps[0]!.dueAt.getTime()).toBeGreaterThan(Date.now());
        calls.length = 0;
        // While the index is busy, the follow-up waits.
        const busy = vi.spyOn(internals(), 'searchIndexBusy').mockResolvedValue(true);
        await pending().update(followUps[0]!.id, { dueAt: new Date(0) });
        await service.deliver(channelId());
        expect(calls).toHaveLength(0);
        expect(await pending().findOneByOrFail({ id: followUps[0]!.id })).toMatchObject({
            boundary: 'listing-settle',
        });
        busy.mockRestore();
        await deliverListingFollowUp();
        expect(calls).toEqual(['test17:listing']);
    });

    it('a category’s new products purge the category, its products and the listings', async () => {
        await clear();
        const variant = await db.rawConnection
            .getRepository(ProductVariant)
            .findOneByOrFail({ sku: 'SAREE-1' });
        await publish(new CollectionModificationEvent(ctx, new Collection({ id: 5 }), [variant.id]));
        await service.deliver(channelId());
        expect(calls[0]!.split(' ')).toEqual(
            expect.arrayContaining([
                'test17:collection:5',
                'test17:listing',
                `test17:product:${variant.productId}`,
            ]),
        );
    });
});

describe('stock', () => {
    it('purges when a real order changes what the product shows, not on every sale', async () => {
        const variant = await db.rawConnection
            .getRepository(ProductVariant)
            .findOneByOrFail({ sku: 'PANJABI-1' });
        const state = () =>
            db.rawConnection
                .getRepository(CacheStockState)
                .findOneByOrFail({ variantId: Number(variant.id) });
        // 4 in stock: "in stock" (2 or fewer is "low stock" by Vendure's default).
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: 'T_1', stockOnHand: 4 }] });
        expect(await state()).toMatchObject({ level: 'IN_STOCK' });
        await clear();
        // Leaves 3: still "in stock", nothing to refresh.
        await placePhoneOrder(shopClient, { phone: '01713009001', variantId: 'T_1' });
        expect(await immediateRows()).toHaveLength(0);
        // Leaves 2: "low stock" now shows on the product page.
        await placePhoneOrder(shopClient, { phone: '01713009002', variantId: 'T_1' });
        const rows = await immediateRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.tags).toEqual(expect.arrayContaining([`product:${variant.productId}`, 'listing']));
        expect(await state()).toMatchObject({ level: 'LOW_STOCK', available: true });
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: 'T_1', stockOnHand: 500 }] });
    }, 60_000);
});

describe('imports', () => {
    it('purges nothing per record during an import, then once for everything', async () => {
        await clear();
        await db.withTransaction(ctx, async tx => {
            markWooImportContext(tx);
            await publish(new StorefrontChangedEvent(tx, ['menus']));
            await publish(new CollectionModificationEvent(tx, new Collection({ id: 5 }), []));
        });
        // A job the import started (its own, unmarked context) is quiet too.
        await publish(new CollectionModificationEvent(ctx, new Collection({ id: 6 }), []));
        expect(await immediateRows()).toHaveLength(0);
        // In case the import dies: a purge-all, due 5 minutes after its last change.
        const catchUp = await pending().findOneByOrFail({ boundary: 'import-catchup' });
        expect(catchUp).toMatchObject({ all: true });
        expect(catchUp.dueAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

        warmRequests.length = 0;
        await publish(new WooImportCompletedEvent(ctx, 1, 1));
        expect(await pending().countBy({ boundary: 'import-catchup' })).toBe(0);
        await service.deliver(channelId());
        expect(calls).toEqual(['test17:store']);
        // Purges go ahead again after the import.
        await publish(new CollectionModificationEvent(ctx, new Collection({ id: 6 }), []));
        expect(await immediateRows()).toHaveLength(1);
        // The purge-all queued a warm-up (the test job queue runs it in this process).
        await vi.waitFor(() => expect(warmRequests.map(r => r.path)).toContain('/'), { timeout: 10_000 });
    });
});

describe('promotion boundaries', () => {
    it('are scheduled when a promotion is saved and replaced when its dates change', async () => {
        await clear();
        const promotion = new Promotion({
            id: 987,
            enabled: true,
            startsAt: new Date(Date.now() + 60_000),
            endsAt: new Date(Date.now() + 120_000),
        });
        await publish(new PromotionEvent(ctx, promotion, 'updated'));
        expect(await pending().countBy({ boundary: 'promotion:987' })).toBe(2);
        promotion.endsAt = null as never;
        await publish(new PromotionEvent(ctx, promotion, 'updated'));
        expect(await pending().countBy({ boundary: 'promotion:987' })).toBe(1);
        await publish(new PromotionEvent(ctx, promotion, 'deleted'));
        expect(await pending().countBy({ boundary: 'promotion:987' })).toBe(0);
    });

    it('purge the pages showing prices when the time comes, not before', async () => {
        await clear();
        const promotion = new Promotion({ id: 988, enabled: true, startsAt: new Date(Date.now() + 1500) });
        await publish(new PromotionEvent(ctx, promotion, 'created'));
        await service.deliver(channelId());
        // The save itself refreshes prices now…
        expect(calls).toEqual(['test17:listing test17:products']);
        await service.deliver(channelId());
        expect(calls).toHaveLength(1);
        // …and the start refreshes them again.
        await sleep(1600);
        await service.tick();
        expect(calls).toEqual(['test17:listing test17:products', 'test17:listing test17:products']);
        expect(await pending().countBy({ boundary: 'promotion:988' })).toBe(0);
    });

    it('a restart purges nothing; a boundary passed while down is still delivered', async () => {
        const promo = await db.rawConnection.getRepository(Promotion).findOneByOrFail({ enabled: true });
        const before = { startsAt: promo.startsAt, endsAt: promo.endsAt };
        try {
            await db.rawConnection.getRepository(Promotion).update(promo.id, {
                startsAt: new Date(Date.now() + 60_000),
                endsAt: new Date(Date.now() + 120_000),
            });
            await clear();
            // A boundary that passed while the worker was down.
            await pending().save(
                new CachePurgeRequest({
                    channelId: channelId(),
                    boundary: 'promotion:999',
                    tags: ['listing', 'products'],
                    all: false,
                    dueAt: new Date(Date.now() - 60_000),
                }),
            );
            const queueWarmUp = vi.spyOn(internals(), 'queueWarmUp');
            // What the worker does at start.
            await service.seedBoundaries();
            expect(await pending().countBy({ boundary: `promotion:${promo.id}` })).toBe(2);
            expect(await pending().countBy({ boundary: 'promotion:999' })).toBe(1);
            expect(await immediateRows()).toHaveLength(0);
            await service.tick();
            // Only the owed boundary: no purge-all, no warm-up.
            expect(calls).toEqual(['test17:listing test17:products']);
            expect(queueWarmUp).not.toHaveBeenCalled();
            queueWarmUp.mockRestore();
        } finally {
            await db.rawConnection.getRepository(Promotion).update(promo.id, before);
            await clear();
        }
    });
});

describe('warm-up', () => {
    it('requests the top pages through the public address, so they fill the shoppers’ entries', async () => {
        // Without a header menu: the top categories, in their order (as the header shows them).
        const { createCollection } = await adminClient.query(CREATE_COLLECTION, {
            input: {
                filters: [],
                translations: [{ languageCode: 'en', name: 'Sarees', slug: 'sarees', description: '' }],
            },
        });
        expect((await service.warm(channelId())).warmed).toContain('/product-category/sarees/');
        // With one: its store links in menu order, then the best sellers.
        await server.app.get(MenuService).update(ctx, {
            header: [
                {
                    label: { bn: 'শাড়ি', en: 'Sarees' },
                    link: { type: 'category', id: createCollection.id },
                    children: [],
                },
                {
                    label: { bn: 'ব্লগ', en: 'Blog' },
                    link: { type: 'url', url: 'https://blog.example.com/' },
                    children: [],
                },
                { label: { bn: 'কার্ট', en: 'Cart' }, link: { type: 'url', url: '/cart/' }, children: [] },
            ],
            footer: [],
        });
        warmRequests.length = 0;
        const { warmed } = await service.warm(channelId());
        expect(warmed.slice(0, 2)).toEqual(['/', '/product-category/sarees/']);
        const products = await db.rawConnection
            .getRepository(Product)
            .find({ relations: { translations: true } });
        expect(warmed[0]).toBe('/');
        for (const product of products)
            expect(warmed).toContain(`/product/${product.translations[0]!.slug}/`);
        // The Host is the store's public one (Varnish's key includes it), never an internal address.
        expect(new Set(warmRequests.map(request => request.headers.host))).toEqual(
            new Set([`127.0.0.1:${SHOP_PORT}`]),
        );
        // Never a page Varnish doesn't keep, or another site.
        expect(warmed.some(path => /^\/(?:cart|checkout|account)|^https?:/.test(path))).toBe(false);
    });

    it('runs once after a Varnish restart, not at every check', async () => {
        const queueWarmUp = vi.spyOn(internals(), 'queueWarmUp');
        const check = async () => {
            internals().lastInstanceCheck = 0;
            await service.tick();
        };
        const channels = await db.rawConnection.getRepository(Channel).count();
        await clear();
        instance = 'varnish-start-1';
        await check();
        const first = queueWarmUp.mock.calls.length;
        await check();
        expect(queueWarmUp.mock.calls.length).toBe(first);
        // A new start: one warm-up per channel, once.
        instance = 'varnish-start-2';
        await check();
        expect(queueWarmUp.mock.calls.length).toBe(first + channels);
        await check();
        expect(queueWarmUp.mock.calls.length).toBe(first + channels);
        // A restart purges nothing.
        expect(calls).toHaveLength(0);
        queueWarmUp.mockRestore();
    });
});

describe('speed measurements', () => {
    const id = (n: number) => `v6-1792742906660-${String(1_000_000_000_000 + n)}`;

    it('keeps anonymous samples per Dhaka day, one row per page view, and reports p75', async () => {
        const vitals = server.app.get(VitalsService);
        const samples = () => db.rawConnection.getRepository(CacheVitalSample);
        await samples().clear();
        for (const [i, value] of [100, 200, 300, 400].entries())
            expect(await vitals.record(ctx, { metricId: id(i), name: 'LCP', value, route: 'product' })).toBe(
                true,
            );
        // web-vitals reports a growing value again under the same ID: one row, the latest value.
        expect(await vitals.record(ctx, { metricId: id(0), name: 'LCP', value: 150, route: 'product' })).toBe(
            true,
        );
        // The same ID can't turn into another metric.
        expect(await vitals.record(ctx, { metricId: id(0), name: 'CLS', value: 0.1, route: 'product' })).toBe(
            false,
        );
        expect(await samples().count()).toBe(4);
        const rows = await samples().find();
        expect(new Set(rows.map(row => row.day))).toEqual(new Set([dhakaDateKey(new Date())]));
        // The stored ID is a hash: no page-load time is kept.
        expect(rows.some(row => row.metricId.includes('1792742906660'))).toBe(false);
        expect((await vitals.daily(ctx))[0]).toMatchObject({
            name: 'LCP',
            route: 'product',
            samples: 4,
            p75: 325,
        });
        expect(
            await vitals.record(ctx, {
                metricId: id(9),
                name: 'CLS',
                value: 0.2,
                route: 'page',
                url: '/private',
            }),
        ).toBe(false);
        // Kept for 31 Dhaka days.
        const kept = dhakaDateKey(new Date(Date.now() - 30 * 86_400_000));
        await samples().update({ metricId: rows[0]!.metricId }, { day: '2020-01-01' });
        await samples().update({ metricId: rows[1]!.metricId }, { day: kept });
        await vitals.cleanup();
        expect(await samples().count()).toBe(3);
    });

    it('accepts beacons from the store’s own pages only, within the per-address limit', async () => {
        const send = (origin: string, body: unknown) =>
            fetch(`http://localhost:${PORT}/cache-metrics`, {
                method: 'POST',
                headers: { origin, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        const sample = { metricId: id(50), name: 'CLS', value: 0.05, route: 'home' };
        expect((await send('https://foreign.example', sample)).status).toBe(403);
        expect((await send(SHOP_URL, sample)).status).toBe(204);
        expect((await send(SHOP_URL, { ...sample, extra: 1 })).status).toBe(400);
        // Over 512 bytes: refused unread.
        expect((await send(SHOP_URL, { ...sample, metricId: 'x'.repeat(600) })).status).toBe(413);
        // 60 a minute from one address (the requests above count too).
        const statuses: number[] = [];
        for (let i = 0; i < 60; i++)
            statuses.push((await send(SHOP_URL, { ...sample, metricId: id(100 + i) })).status);
        expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
        expect(statuses[statuses.length - 1]).toBe(429);
    });

    it('reports to staff with ReadSettings only', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(DAILY_VITALS)).rejects.toThrow();
        await adminClient.asSuperAdmin();
        expect((await adminClient.query(DAILY_VITALS)).cacheDailyVitals).toBeInstanceOf(Array);
    });
});

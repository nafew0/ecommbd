import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import {
    EventBus,
    ProductVariant,
    ProductVariantService,
    StockMovementService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
    Promotion,
    PromotionEvent,
} from '@vendure/core';
import { createServer, type Server } from 'node:http';
import gql from 'graphql-tag';
import { beforeAll, afterAll, it, expect } from 'vitest';
import {
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
    addMigrationOnlyObjects,
} from '../support/test-config';
import { CachePurgeService } from '../../src/plugins/cache-purge/cache-purge.service';
import { CachePurgeRequest, CacheStockState, CacheVitalSample } from '../../src/plugins/cache-purge/entities';
import { StorefrontChangedEvent } from '../../src/plugins/cache-purge/events';
import { VitalsService } from '../../src/plugins/cache-purge/vitals';
import { markWooImportContext, WooImportCompletedEvent } from '../../src/plugins/woo-import/context';

registerInitializer('postgres', new PostgresInitializer());
const config = createTestConfig(
    3077,
    {},
    {
        cacheStoreId: 'test17',
        cachePurgeUrl: 'http://127.0.0.1:3078/',
        cachePurgeSecret: '0'.repeat(64),
        cacheBatchMs: 0,
        cachePollMs: 3600000,
    },
);
const { server, adminClient } = createTestEnvironment(config);
let endpoint: Server, db: TransactionalConnection, service: CachePurgeService, ctx: RequestContext;
let accepted = true;
const calls: string[] = [];
beforeAll(async () => {
    endpoint = createServer((req, res) => {
        calls.push(String(req.headers['x-purge-tags']));
        res.writeHead(accepted ? 200 : 503);
        res.end();
    });
    await new Promise<void>(resolve => endpoint.listen(3078, resolve));
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
});
afterAll(async () => {
    await server.destroy();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
});
const pending = () => db.rawConnection.getRepository(CachePurgeRequest);
async function clear() {
    await pending().clear();
    calls.length = 0;
}
it('stores invalidation in the transaction and discards a rolled-back mutation', async () => {
    await clear();
    await expect(
        db.withTransaction(ctx, async tx => {
            await server.app.get(EventBus).publish(new StorefrontChangedEvent(tx, ['menus']));
            throw new Error('rollback');
        }),
    ).rejects.toThrow('rollback');
    expect(await pending().count()).toBe(0);
});
it('batches duplicate tags into one scoped purge after mutation commit', async () => {
    await clear();
    await service.enqueue(ctx, ['catalog', 'menus']);
    await service.enqueue(ctx, ['catalog']);
    await service.deliver(Number(ctx.channelId));
    expect(calls).toEqual(['test17:catalog test17:menus']);
    expect(await pending().count()).toBe(0);
    await service.deliver(Number(ctx.channelId));
    expect(calls).toHaveLength(1);
});
it('retains failed deliveries for retry and clears them after success', async () => {
    await clear();
    await service.enqueue(ctx, ['catalog']);
    accepted = false;
    await expect(service.deliver(Number(ctx.channelId))).rejects.toThrow();
    expect(await pending().count()).toBe(1);
    accepted = true;
    await pending()
        .createQueryBuilder()
        .update()
        .set({ dueAt: new Date(0) })
        .execute();
    await service.deliver(Number(ctx.channelId));
    expect(await pending().count()).toBe(0);
});
it('uses one full-store purge for bulk work, without per-record effects', async () => {
    await clear();
    await db.withTransaction(ctx, async tx => {
        markWooImportContext(tx);
        await server.app.get(EventBus).publish(new StorefrontChangedEvent(tx, ['catalog']));
    });
    expect(await pending().count()).toBe(0);
    await server.app.get(EventBus).publish(new WooImportCompletedEvent(ctx, 1, 1));
    await service.deliver(Number(ctx.channelId));
    expect(calls).toEqual(['test17:store']);
});
it('invalidates on stock crossing zero, rather than on each stock reduction', async () => {
    const variant = await db.rawConnection.getRepository(ProductVariant).findOneByOrFail({});
    const variants = server.app.get(ProductVariantService);
    await variants.update(ctx, [{ id: variant.id, stockOnHand: 10 }]);
    await clear();
    await server.app.get(StockMovementService).adjustProductVariantStock(ctx, variant.id, 9);
    expect(await pending().count()).toBe(0);
    await server.app.get(StockMovementService).adjustProductVariantStock(ctx, variant.id, 0);
    expect(await pending().count()).toBe(1);
    expect(
        await db.rawConnection
            .getRepository(CacheStockState)
            .findOneByOrFail({ variantId: Number(variant.id) }),
    ).toMatchObject({ available: false });
    await clear();
    await server.app.get(StockMovementService).adjustProductVariantStock(ctx, variant.id, 2);
    expect(await pending().count()).toBe(1);
});
it('persists promotion start/end boundaries and replaces them when dates change', async () => {
    await clear();
    const promo = new Promotion({
        id: 987,
        startsAt: new Date(Date.now() + 60000),
        endsAt: new Date(Date.now() + 120000),
    });
    await server.app.get(EventBus).publish(new PromotionEvent(ctx, promo, 'updated'));
    const rows = await pending().find();
    expect(rows.filter(r => r.boundary === 'promotion:987')).toHaveLength(2);
    await server.app.get(EventBus).publish(new PromotionEvent(ctx, promo, 'deleted'));
    expect((await pending().find()).filter(r => r.boundary === 'promotion:987')).toHaveLength(0);
});
it('deduplicates bounded private-free measurements and computes daily p75', async () => {
    const vitals = server.app.get(VitalsService);
    for (const [i, value] of [100, 200, 300, 400].entries())
        expect(
            await vitals.record(ctx, { metricId: 'synthetic17-' + i, name: 'LCP', value, route: 'product' }),
        ).toBe(true);
    await vitals.record(ctx, { metricId: 'synthetic17-0', name: 'LCP', value: 100, route: 'product' });
    expect(await db.rawConnection.getRepository(CacheVitalSample).count()).toBe(4);
    expect((await vitals.daily(ctx))[0]).toMatchObject({ name: 'LCP', samples: 4, p75: 325 });
    expect(
        await vitals.record(ctx, {
            metricId: 'bad-input-17',
            name: 'CLS',
            value: 0.2,
            route: 'page',
            url: '/private-phone',
        }),
    ).toBe(false);
    await db.rawConnection
        .getRepository(CacheVitalSample)
        .createQueryBuilder()
        .update()
        .set({ day: '2020-01-01' })
        .execute();
    await vitals.cleanup();
    expect(await db.rawConnection.getRepository(CacheVitalSample).count()).toBe(0);
});
it('backfills future promotion boundaries on an existing store after restart', async () => {
    const promo = await db.rawConnection.getRepository(Promotion).findOneByOrFail({ enabled: true });
    const before = { startsAt: promo.startsAt, endsAt: promo.endsAt };
    try {
        await db.rawConnection
            .getRepository(Promotion)
            .update(promo.id, {
                startsAt: new Date(Date.now() + 60000),
                endsAt: new Date(Date.now() + 120000),
            });
        await clear();
        await service.seedBoundaries();
        expect(await pending().countBy({ boundary: `promotion:${promo.id}` })).toBe(2);
    } finally {
        await db.rawConnection.getRepository(Promotion).update(promo.id, before);
        await clear();
    }
});
it('protects daily reports and accepts only same-origin anonymous beacons', async () => {
    const body = JSON.stringify({ metricId: 'anonymous-beacon-17', name: 'CLS', value: 0.05, route: 'home' });
    const send = (origin: string) =>
        fetch('http://localhost:3077/cache-metrics', {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body,
        });
    expect((await send('https://foreign.example')).status).toBe(403);
    expect((await send('https://shop.example.com')).status).toBe(204);
    await adminClient.asAnonymousUser();
    await expect(
        adminClient.query(gql`
            {
                cacheDailyVitals
            }
        `),
    ).rejects.toThrow();
    await adminClient.asSuperAdmin();
    expect(
        (
            await adminClient.query(gql`
                {
                    cacheDailyVitals
                }
            `)
        ).cacheDailyVitals,
    ).toBeInstanceOf(Array);
});

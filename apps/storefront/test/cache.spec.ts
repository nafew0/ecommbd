import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { DataCache } from '../src/lib/cache';

/** The cache Redis from the root docker-compose.yml (`npm run services:up`). */
const host = process.env.TEST_REDIS_CACHE_HOST ?? '127.0.0.1';
const port = Number(process.env.TEST_REDIS_CACHE_PORT ?? 63791);

describe('the data cache without Redis', () => {
    it('loads once, even for requests at the same moment', async () => {
        const cache = new DataCache({ ttlSeconds: 60, prefix: 'test' });
        let loads = 0;
        const load = async () => {
            loads++;
            await new Promise(resolve => setTimeout(resolve, 20));
            return { name: 'Rahim Fashion' };
        };
        const [a, b] = await Promise.all([
            cache.get('settings', ['settings'], load),
            cache.get('settings', ['settings'], load),
        ]);
        expect(a).toEqual(b);
        expect(await cache.get('settings', ['settings'], load)).toEqual({ name: 'Rahim Fashion' });
        expect(loads).toBe(1);
    });

    it('forgets entries by tag', async () => {
        const cache = new DataCache({ ttlSeconds: 60, prefix: 'test' });
        let version = 1;
        const menus = () => cache.get('menus:bn', ['menus'], async () => version);
        const settings = () => cache.get('settings', ['settings'], async () => version);
        expect([await menus(), await settings()]).toEqual([1, 1]);
        version = 2;
        await cache.invalidate(['menus']);
        expect([await menus(), await settings()]).toEqual([2, 1]);
    });

    it('can be turned off (TTL 0)', async () => {
        const cache = new DataCache({ ttlSeconds: 0, prefix: 'test' });
        let loads = 0;
        await cache.get('x', [], async () => ++loads);
        await cache.get('x', [], async () => ++loads);
        expect(loads).toBe(2);
    });
});

/** Unit tests run without services too: the Redis part is skipped when Redis isn't up. */
const redisUp = await new Promise<boolean>(resolve => {
    const probe = new Redis({ host, port, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    probe.on('error', () => undefined);
    probe.connect().then(
        () => {
            void probe.quit();
            resolve(true);
        },
        () => resolve(false),
    );
});

describe.skipIf(!redisUp)('the data cache with Redis', () => {
    const prefix = `test-sf-${Date.now()}`;
    const caches: DataCache[] = [];
    const make = () => {
        const cache = new DataCache({ ttlSeconds: 60, prefix, redis: { host, port } });
        caches.push(cache);
        return cache;
    };

    afterAll(async () => {
        const redis = new Redis({ host, port });
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length) await redis.del(...keys);
        await redis.quit();
        await Promise.all(caches.map(cache => cache.close()));
    });

    it('shares entries between processes, and a purge reaches every process', async () => {
        const first = make();
        const second = make();
        // Let both subscribe to the purge channel.
        await new Promise(resolve => setTimeout(resolve, 200));
        let version = 1;
        expect(await first.get('collections:top:bn', ['collections'], async () => version)).toBe(1);
        version = 2;
        // The second process gets the shared copy, not a fresh load.
        expect(await second.get('collections:top:bn', ['collections'], async () => version)).toBe(1);

        await first.invalidate(['collections']);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(await second.get('collections:top:bn', ['collections'], async () => version)).toBe(2);
    });

    it('keeps working when Redis is down', async () => {
        const cache = new DataCache({ ttlSeconds: 60, prefix, redis: { host, port: 1 } });
        caches.push(cache);
        expect(await cache.get('settings', ['settings'], async () => 'loaded')).toBe('loaded');
        await cache.invalidate(['settings']);
    });
});

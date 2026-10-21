import { describe, expect, it } from 'vitest';
import {
    hitRateLimit,
    MemoryRateLimitStore,
    RedisRateLimitStore,
    type RedisScriptClient,
} from './rate-limit';

describe('hitRateLimit with the memory store', () => {
    it('allows up to the limit, then refuses until the window resets', async () => {
        let now = 1_000;
        const store = new MemoryRateLimitStore(() => now);
        const rule = { limit: 2, windowMs: 60_000 };
        expect(await hitRateLimit(store, 'phone:1', rule)).toEqual({
            allowed: true,
            count: 1,
            retryAfterMs: 0,
        });
        expect(await hitRateLimit(store, 'phone:1', rule)).toEqual({
            allowed: true,
            count: 2,
            retryAfterMs: 0,
        });
        now += 10_000;
        expect(await hitRateLimit(store, 'phone:1', rule)).toEqual({
            allowed: false,
            count: 3,
            retryAfterMs: 50_000,
        });
        // Other keys have their own window.
        expect((await hitRateLimit(store, 'phone:2', rule)).allowed).toBe(true);
        now += 50_000;
        expect(await hitRateLimit(store, 'phone:1', rule)).toEqual({
            allowed: true,
            count: 1,
            retryAfterMs: 0,
        });
    });

    it('uses the real clock by default', async () => {
        const store = new MemoryRateLimitStore();
        expect((await hitRateLimit(store, 'key', { limit: 1, windowMs: 1000 })).allowed).toBe(true);
        expect((await hitRateLimit(store, 'key', { limit: 1, windowMs: 1000 })).allowed).toBe(false);
    });

    it('counts concurrent requests one by one', async () => {
        const store = new MemoryRateLimitStore();
        const results = await Promise.all(
            Array.from({ length: 10 }, () => hitRateLimit(store, 'burst', { limit: 3, windowMs: 1000 })),
        );
        expect(results.filter(result => result.allowed)).toHaveLength(3);
    });
});

describe('RedisRateLimitStore', () => {
    it('runs one script with the prefixed key and window, and returns its count and expiry', async () => {
        const calls: unknown[][] = [];
        const redis: RedisScriptClient = {
            async eval(...args) {
                calls.push(args);
                return [4, 1234];
            },
        };
        const store = new RedisRateLimitStore(redis, 's1:rl:');
        expect(
            await hitRateLimit(store, 'checkout:phone:+8801712345678', { limit: 3, windowMs: 60_000 }),
        ).toEqual({
            allowed: false,
            count: 4,
            retryAfterMs: 1234,
        });
        const [script, numKeys, key, windowMs] = calls[0]!;
        expect(script).toContain("redis.call('INCR'");
        expect(script).toContain("redis.call('PEXPIRE'");
        expect(numKeys).toBe(1);
        expect(key).toBe('s1:rl:checkout:phone:+8801712345678');
        expect(windowMs).toBe(60_000);
    });
});

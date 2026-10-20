import { describe, expect, it, vi } from 'vitest';
import {
    fingerprint,
    IdempotencyConflictError,
    IdempotencyInProgressError,
    type IdempotencyStore,
    isValidIdempotencyKey,
    MemoryIdempotencyStore,
    runIdempotent,
    stableStringify,
} from './idempotency';

const KEY = 'order-key-1234567890';

describe('keys and fingerprints', () => {
    it('validates key format', () => {
        expect(isValidIdempotencyKey(KEY)).toBe(true);
        expect(isValidIdempotencyKey('short')).toBe(false);
        expect(isValidIdempotencyKey('has spaces in it 123')).toBe(false);
        expect(isValidIdempotencyKey(42)).toBe(false);
    });

    it('serializes deterministically', () => {
        expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 3n }], e: new Date(0) })).toBe(
            '{"a":[2,{"c":"3"}],"b":1,"e":"1970-01-01T00:00:00.000Z"}',
        );
        expect(stableStringify(undefined)).toBe('undefined');
        const shared = { x: 1 };
        expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => stableStringify(cyclic)).toThrow('circular');
    });

    it('gives the same fingerprint regardless of key order', () => {
        expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
        expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    });
});

describe('MemoryIdempotencyStore', () => {
    it('stores, expires and deletes records', async () => {
        let now = 1_000;
        const store = new MemoryIdempotencyStore(() => now);
        const record = { fingerprint: 'f', status: 'completed' as const, result: 1 };
        expect(await store.setIfAbsent('k', record, 100)).toBe(true);
        expect(await store.setIfAbsent('k', record, 100)).toBe(false);
        expect(await store.get('k')).toEqual(record);
        now = 1_100;
        expect(await store.get('k')).toBeUndefined();
        await store.set('k', record, 100);
        await store.delete('k');
        expect(await store.get('k')).toBeUndefined();
        expect(await new MemoryIdempotencyStore().get('missing')).toBeUndefined();
    });
});

describe('runIdempotent', () => {
    it('runs once and replays the result for the same key and payload', async () => {
        const store = new MemoryIdempotencyStore();
        const work = vi.fn(async () => ({ orderNumber: 1001 }));
        expect(await runIdempotent(store, KEY, { cart: 1 }, work)).toEqual({
            result: { orderNumber: 1001 },
            replayed: false,
        });
        expect(await runIdempotent(store, KEY, { cart: 1 }, work, { ttlMs: 1000 })).toEqual({
            result: { orderNumber: 1001 },
            replayed: true,
        });
        expect(work).toHaveBeenCalledTimes(1);
    });

    it('refuses the same key with a different payload', async () => {
        const store = new MemoryIdempotencyStore();
        await runIdempotent(store, KEY, { cart: 1 }, async () => 1);
        await expect(runIdempotent(store, KEY, { cart: 2 }, async () => 2)).rejects.toBeInstanceOf(
            IdempotencyConflictError,
        );
    });

    it('refuses a retry while the first request is still running', async () => {
        const store = new MemoryIdempotencyStore();
        let finish: () => void = () => undefined;
        const first = runIdempotent(store, KEY, {}, () => new Promise<void>(resolve => (finish = resolve)));
        await expect(runIdempotent(store, KEY, {}, async () => undefined)).rejects.toBeInstanceOf(
            IdempotencyInProgressError,
        );
        finish();
        await first;
    });

    it('runs the work only once when identical requests arrive at the same moment', async () => {
        const store = new MemoryIdempotencyStore();
        let runs = 0;
        const work = async () => {
            runs += 1;
            return 'order';
        };
        const results = await Promise.allSettled(
            Array.from({ length: 5 }, () => runIdempotent(store, KEY, { cart: 1 }, work)),
        );
        expect(runs).toBe(1);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    });

    it('treats a record that vanished between checks as in progress', async () => {
        const store: IdempotencyStore = {
            get: async () => undefined,
            setIfAbsent: async () => false,
            set: async () => undefined,
            delete: async () => undefined,
        };
        await expect(runIdempotent(store, KEY, {}, async () => 1)).rejects.toBeInstanceOf(
            IdempotencyInProgressError,
        );
    });

    it('releases the key when the work fails, so the client can retry', async () => {
        const store = new MemoryIdempotencyStore();
        await expect(
            runIdempotent(store, KEY, {}, async () => {
                throw new Error('gateway down');
            }),
        ).rejects.toThrow('gateway down');
        expect(await runIdempotent(store, KEY, {}, async () => 'ok')).toEqual({
            result: 'ok',
            replayed: false,
        });
    });

    it('rejects invalid keys', async () => {
        await expect(runIdempotent(new MemoryIdempotencyStore(), 'bad', {}, async () => 1)).rejects.toThrow(
            'Invalid idempotency key',
        );
    });
});

import { createHash } from 'node:crypto';

/**
 * Idempotency keys: a client sends the same key when it retries a create-type request
 * (place order, book courier, start payment), and gets the first result back instead of
 * creating a duplicate.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidIdempotencyKey(key: unknown): key is string {
    return typeof key === 'string' && KEY_PATTERN.test(key);
}

/** JSON with object keys sorted, so the same payload always gives the same text. */
export function stableStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    const walk = (current: unknown): unknown => {
        if (typeof current === 'bigint') {
            return current.toString();
        }
        if (current instanceof Date) {
            return current.toISOString();
        }
        if (current === null || typeof current !== 'object') {
            return current;
        }
        if (seen.has(current)) {
            throw new TypeError('Cannot fingerprint a value with circular references');
        }
        seen.add(current);
        const result = Array.isArray(current)
            ? current.map(item => walk(item))
            : Object.fromEntries(
                  Object.keys(current)
                      .sort()
                      .filter(key => (current as Record<string, unknown>)[key] !== undefined)
                      .map(key => [key, walk((current as Record<string, unknown>)[key])]),
              );
        seen.delete(current);
        return result;
    };
    return JSON.stringify(walk(value)) ?? 'undefined';
}

/** SHA-256 of the payload's stable JSON: detects a reused key with a different request. */
export function fingerprint(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export interface IdempotencyRecord<T = unknown> {
    fingerprint: string;
    status: 'in_progress' | 'completed';
    result?: T;
}

/** Storage for idempotency records. Implementations: in-memory (tests), Redis or database (later phases). */
export interface IdempotencyStore {
    get(key: string): Promise<IdempotencyRecord | undefined>;
    /**
     * Stores the record only if the key is free, **atomically** (Redis `SET NX`, a database unique
     * constraint). Returns false if it already existed.
     */
    setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean>;
    set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
    delete(key: string): Promise<void>;
}

export class IdempotencyConflictError extends Error {
    constructor() {
        super('This idempotency key was already used with a different request');
        this.name = 'IdempotencyConflictError';
    }
}

export class IdempotencyInProgressError extends Error {
    constructor() {
        super('A request with this idempotency key is still being processed');
        this.name = 'IdempotencyInProgressError';
    }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
    private readonly records = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    private read(key: string): IdempotencyRecord | undefined {
        const entry = this.records.get(key);
        if (entry && entry.expiresAt <= this.now()) {
            this.records.delete(key);
            return undefined;
        }
        return entry?.record;
    }

    async get(key: string): Promise<IdempotencyRecord | undefined> {
        return this.read(key);
    }

    async setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean> {
        // Check and set with no await in between: two concurrent callers can't both claim the key.
        if (this.read(key)) {
            return false;
        }
        this.records.set(key, { record, expiresAt: this.now() + ttlMs });
        return true;
    }

    async set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
        this.records.set(key, { record, expiresAt: this.now() + ttlMs });
    }

    async delete(key: string): Promise<void> {
        this.records.delete(key);
    }
}

export interface RunIdempotentOptions {
    /** How long the stored result is kept. Default 24 hours. */
    ttlMs?: number;
}

/**
 * Runs `work` at most once per key. A retry with the same key and payload gets the stored
 * result (`replayed: true`); the same key with a different payload is a conflict. If `work`
 * fails, the key is released so the client can retry.
 */
export async function runIdempotent<T>(
    store: IdempotencyStore,
    key: string,
    payload: unknown,
    work: () => Promise<T>,
    options: RunIdempotentOptions = {},
): Promise<{ result: T; replayed: boolean }> {
    if (!isValidIdempotencyKey(key)) {
        throw new TypeError('Invalid idempotency key: use 16–128 letters, digits, "-" or "_"');
    }
    const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    const print = fingerprint(payload);
    const claimed = await store.setIfAbsent(key, { fingerprint: print, status: 'in_progress' }, ttlMs);
    if (!claimed) {
        const existing = await store.get(key);
        if (existing && existing.fingerprint !== print) {
            throw new IdempotencyConflictError();
        }
        if (existing?.status === 'completed') {
            return { result: existing.result as T, replayed: true };
        }
        throw new IdempotencyInProgressError();
    }
    try {
        const result = await work();
        await store.set(key, { fingerprint: print, status: 'completed', result }, ttlMs);
        return { result, replayed: false };
    } catch (error) {
        await store.delete(key);
        throw error;
    }
}

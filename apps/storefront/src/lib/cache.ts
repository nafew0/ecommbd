import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';

/**
 * The storefront's data cache (roadmap phase 12): store settings, menus and categories, kept in
 * this process (LRU) and in the cache Redis, shared by every storefront process of the store.
 *
 * Entries carry tags (`settings`, `menus`, `collections`). `invalidate(tags)` deletes them in Redis
 * and publishes the tags, so every process drops its own copies; the core sends these purges from
 * phase 17. Until then entries simply expire (`CACHE_TTL_SECONDS`, 60 by default).
 *
 * Redis is optional and never required: if it's missing or down, the cache works per process.
 */

interface Entry {
    value: unknown;
    tags: string[];
}

export interface DataCacheOptions {
    ttlSeconds: number;
    /** Keys and the purge channel live under `<prefix>:sf:`. */
    prefix: string;
    redis?: { host: string; port: number; username?: string; password?: string };
    /** For tests: a Redis client to use instead of connecting. */
    client?: Redis;
    subscriber?: Redis;
    maxEntries?: number;
}

export class DataCache {
    private local: LRUCache<string, Entry>;
    private loading = new Map<string, Promise<unknown>>();
    private redis?: Redis;
    private subscriber?: Redis;
    private readonly channel: string;

    constructor(private options: DataCacheOptions) {
        this.local = new LRUCache({
            max: options.maxEntries ?? 500,
            ttl: Math.max(options.ttlSeconds, 1) * 1000,
        });
        this.channel = `${options.prefix}:sf:purge`;
        const connect = () =>
            new Redis({
                ...options.redis!,
                lazyConnect: false,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
            });
        this.redis = options.client ?? (options.redis ? connect() : undefined);
        this.subscriber = options.subscriber ?? (options.redis ? connect() : undefined);
        this.redis?.on('error', () => undefined);
        this.subscriber?.on('error', () => undefined);
        // On every (re)connection: a subscription made while offline would be dropped.
        this.subscriber?.on('ready', () => {
            this.subscriber?.subscribe(this.channel).catch(() => undefined);
        });
        this.subscriber?.on('message', (_channel: string, message: string) => {
            this.dropLocal(message.split(','));
        });
    }

    private key(name: string) {
        return `${this.options.prefix}:sf:data:${name}`;
    }

    private tagKey(tag: string) {
        return `${this.options.prefix}:sf:tag:${tag}`;
    }

    /** The cached value, or `load()`'s, stored under `name` with `tags`. One load per key at a time. */
    async get<T>(name: string, tags: string[], load: () => Promise<T>): Promise<T> {
        if (this.options.ttlSeconds === 0) return load();
        const local = this.local.get(name);
        if (local) return local.value as T;
        const pending = this.loading.get(name);
        if (pending) return pending as Promise<T>;
        const promise = this.fetch(name, tags, load).finally(() => this.loading.delete(name));
        this.loading.set(name, promise);
        return promise;
    }

    private async fetch<T>(name: string, tags: string[], load: () => Promise<T>): Promise<T> {
        const shared = await this.redis?.get(this.key(name)).catch(() => null);
        if (shared) {
            const value = JSON.parse(shared) as T;
            this.local.set(name, { value, tags });
            return value;
        }
        const value = await load();
        this.local.set(name, { value, tags });
        if (this.redis) {
            const ttl = this.options.ttlSeconds;
            const pipeline = this.redis.multi().set(this.key(name), JSON.stringify(value), 'EX', ttl);
            for (const tag of tags) pipeline.sadd(this.tagKey(tag), name).expire(this.tagKey(tag), ttl * 2);
            await pipeline.exec().catch(() => undefined);
        }
        return value;
    }

    /** Forgets everything tagged with any of `tags`, here, in Redis and in every other process. */
    async invalidate(tags: string[]) {
        this.dropLocal(tags);
        if (!this.redis) return;
        try {
            for (const tag of tags) {
                const names = await this.redis.smembers(this.tagKey(tag));
                if (names.length) await this.redis.del(...names.map(name => this.key(name)));
                await this.redis.del(this.tagKey(tag));
            }
            await this.redis.publish(this.channel, tags.join(','));
        } catch {
            // Redis is down: entries expire on their own.
        }
    }

    private dropLocal(tags: string[]) {
        for (const [name, entry] of this.local.entries()) {
            if (entry.tags.some(tag => tags.includes(tag))) this.local.delete(name);
        }
    }

    async close() {
        await Promise.all([this.redis?.quit(), this.subscriber?.quit()].map(p => p?.catch(() => undefined)));
    }
}

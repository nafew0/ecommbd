import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';

/**
 * The storefront's data cache (roadmap phase 12): store settings, menus and categories, kept in
 * this process (LRU) and in the cache Redis, shared by every storefront process of the store.
 *
 * Entries carry tags (`settings`, `menus`, `collections`, `product:<id>`…). The core's purges
 * (phase 17, apps/core/src/plugins/cache-purge) delete tagged entries in Redis and publish the tags,
 * so every process drops its own copies; `invalidate(tags)` does the same from here. Entries also
 * expire on their own (`CACHE_TTL_SECONDS`, 60 by default).
 *
 * Redis is optional and never required: if it's missing or down, the cache works per process.
 */

interface Entry {
    value: unknown;
    tags: string[];
}

/** An entry's tags, given or worked out from the loaded value. */
export type Tags<T> = string[] | ((value: T) => string[]);

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
    private generation = 0;

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
            this.generation++;
            this.local.clear();
            this.loading.clear();
            this.subscriber?.subscribe(this.channel).catch(() => undefined);
        });
        this.subscriber?.on('message', (_channel: string, message: string) => {
            this.generation++;
            this.loading.clear();
            this.dropLocal(message.split(','));
        });
    }

    private key(name: string) {
        return `${this.options.prefix}:sf:data:${name}`;
    }

    private tagKey(tag: string) {
        return `${this.options.prefix}:sf:tag:${tag}`;
    }

    /**
     * The cached value, or `load()`'s, stored under `name` with `tags`. One load per key at a time.
     * `tags` may be worked out from the value, for tags only the data knows (a sales page's product).
     */
    async get<T>(name: string, tags: Tags<T>, load: () => Promise<T>): Promise<T> {
        if (this.options.ttlSeconds === 0) return load();
        const local = this.local.get(name);
        if (local) return local.value as T;
        const pending = this.loading.get(name);
        if (pending) return pending as Promise<T>;
        const promise = this.fetch(name, tags, load).finally(() => {
            if (this.loading.get(name) === promise) this.loading.delete(name);
        });
        this.loading.set(name, promise);
        return promise;
    }

    /**
     * Redis, else `load()`. Two generation counters stop an old value from coming back after a
     * purge: this process's (a purge heard while loading means the loaded value isn't kept here)
     * and the shared one in Redis (a purge anywhere since the load began means it isn't stored).
     */
    private async fetch<T>(name: string, tags: Tags<T>, load: () => Promise<T>): Promise<T> {
        const tagsOf = (value: T) => (typeof tags === 'function' ? tags(value) : tags);
        const localGeneration = this.generation;
        const generationKey = `${this.options.prefix}:sf:generation`;
        const sharedGeneration = (await this.redis?.get(generationKey).catch(() => null)) ?? '0';
        const shared = await this.redis?.get(this.key(name)).catch(() => null);
        if (shared) {
            const value = JSON.parse(shared) as T;
            if (localGeneration === this.generation) this.local.set(name, { value, tags: tagsOf(value) });
            return value;
        }
        const value = await load();
        const entryTags = tagsOf(value);
        if (localGeneration === this.generation) this.local.set(name, { value, tags: entryTags });
        if (this.redis) {
            const ttl = this.options.ttlSeconds;
            // Stores the value only if the shared generation is still the one read before loading,
            // then adds its name to each tag's set (kept twice as long as the value, so a tag never
            // forgets a live entry). Everything also goes under `*`, the core's "purge all".
            const inserted = await this.redis
                .eval(
                    `
                if (redis.call('GET',KEYS[1]) or '0') ~= ARGV[1] then return 0 end
                redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]);
                for i=5,#ARGV do redis.call('SADD',ARGV[i],ARGV[4]); redis.call('EXPIRE',ARGV[i],ARGV[3]*2); end
                return 1;
            `,
                    2,
                    generationKey,
                    this.key(name),
                    sharedGeneration,
                    JSON.stringify(value),
                    ttl,
                    name,
                    ...[...new Set([...entryTags, '*'])].map(t => this.tagKey(t)),
                )
                .catch(() => undefined);
            if (inserted === 0) this.local.delete(name);
        }
        return value;
    }

    /** Forgets everything tagged with any of `tags`, here, in Redis and in every other process. */
    async invalidate(tags: string[]) {
        this.generation++;
        this.loading.clear();
        this.dropLocal(tags);
        if (!this.redis) return;
        try {
            await this.redis.incr(`${this.options.prefix}:sf:generation`);
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
        if (tags.includes('*')) {
            this.local.clear();
            return;
        }
        for (const [name, entry] of this.local.entries()) {
            if (entry.tags.some(tag => tags.includes(tag))) this.local.delete(name);
        }
    }

    async close() {
        await Promise.all([this.redis?.quit(), this.subscriber?.quit()].map(p => p?.catch(() => undefined)));
    }
}

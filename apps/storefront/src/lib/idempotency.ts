import {
    type IdempotencyRecord,
    type IdempotencyStore,
    MemoryIdempotencyStore,
} from '@ecommbd/shared/idempotency';
import { Redis } from 'ioredis';
import { env } from '../env';

/**
 * Where "place order" results are kept per idempotency key (roadmap phase 14): the cache Redis,
 * shared by every storefront process, or this process's memory when Redis is missing or down.
 */
class FallbackIdempotencyStore implements IdempotencyStore {
    private readonly memory = new MemoryIdempotencyStore();

    constructor(
        private readonly redis: Redis | undefined,
        private readonly prefix: string,
    ) {}

    private key(key: string) {
        return `${this.prefix}:sf:idem:${key}`;
    }

    private async attempt<T>(
        withRedis: (redis: Redis) => Promise<T>,
        withMemory: () => Promise<T>,
    ): Promise<T> {
        if (!this.redis || this.redis.status !== 'ready') return withMemory();
        try {
            return await withRedis(this.redis);
        } catch {
            return withMemory();
        }
    }

    get(key: string): Promise<IdempotencyRecord | undefined> {
        return this.attempt(
            async redis => {
                const value = await redis.get(this.key(key));
                return value ? (JSON.parse(value) as IdempotencyRecord) : undefined;
            },
            () => this.memory.get(key),
        );
    }

    setIfAbsent(key: string, record: IdempotencyRecord, ttlMs: number): Promise<boolean> {
        return this.attempt(
            async redis =>
                (await redis.set(this.key(key), JSON.stringify(record), 'PX', ttlMs, 'NX')) === 'OK',
            () => this.memory.setIfAbsent(key, record, ttlMs),
        );
    }

    set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
        return this.attempt(
            async redis => {
                await redis.set(this.key(key), JSON.stringify(record), 'PX', ttlMs);
            },
            () => this.memory.set(key, record, ttlMs),
        );
    }

    delete(key: string): Promise<void> {
        return this.attempt(
            async redis => {
                await redis.del(this.key(key));
            },
            () => this.memory.delete(key),
        );
    }
}

let instance: IdempotencyStore | undefined;

export function idempotencyStore(): IdempotencyStore {
    if (!instance) {
        const config = env();
        const redis =
            config.REDIS_CACHE_HOST && config.REDIS_CACHE_PORT
                ? new Redis({
                      host: config.REDIS_CACHE_HOST,
                      port: config.REDIS_CACHE_PORT,
                      username: config.REDIS_CACHE_USERNAME,
                      password: config.REDIS_CACHE_PASSWORD,
                      maxRetriesPerRequest: 1,
                      enableOfflineQueue: false,
                  })
                : undefined;
        redis?.on('error', () => undefined);
        instance = new FallbackIdempotencyStore(redis, config.REDIS_KEY_PREFIX);
    }
    return instance;
}

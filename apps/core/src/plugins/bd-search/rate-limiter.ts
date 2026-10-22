import { hitRateLimit, type RateLimitRule, RedisRateLimitStore } from '@ecommbd/shared';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@vendure/core';
import Redis from 'ioredis';
import {
    BD_SEARCH_PLUGIN_OPTIONS,
    type BdSearchPluginOptions,
    DEFAULT_SEARCH_RATE_LIMITS,
    loggerCtx,
    type SearchRateLimits,
} from './constants';

/**
 * Rate limits for search and suggestions, counted per client IP in the cache Redis. If Redis can't
 * be reached, requests are allowed (and a warning logged): search must keep working.
 */
@Injectable()
export class SearchRateLimiter implements OnModuleDestroy {
    readonly rules: SearchRateLimits;
    private readonly redis: Redis;
    private readonly store: RedisRateLimitStore;

    constructor(@Inject(BD_SEARCH_PLUGIN_OPTIONS) options: BdSearchPluginOptions) {
        this.rules = { ...DEFAULT_SEARCH_RATE_LIMITS, ...options.rateLimits };
        // Connects on first use, so the worker process (which never searches) opens no connection.
        this.redis = new Redis({
            ...options.redis,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            commandTimeout: 1000,
        });
        this.redis.on('error', () => undefined);
        this.store = new RedisRateLimitStore(this.redis, options.rateLimitKeyPrefix);
    }

    /** Counts one request. Returns the seconds to wait when refused, or 0 when allowed. */
    async hit(key: string, rule: RateLimitRule): Promise<number> {
        try {
            const result = await hitRateLimit(this.store, key, rule);
            return result.allowed ? 0 : Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        } catch (error) {
            Logger.warn(`Search rate limit skipped (Redis unavailable): ${String(error)}`, loggerCtx);
            return 0;
        }
    }

    async onModuleDestroy() {
        if (this.redis.status === 'ready') {
            await this.redis.quit();
        } else {
            this.redis.disconnect();
        }
    }
}

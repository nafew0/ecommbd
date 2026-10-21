import { hitRateLimit, type RateLimitRule, RedisRateLimitStore } from '@ecommbd/shared';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@vendure/core';
import Redis from 'ioredis';
import {
    BD_TRACKING_PLUGIN_OPTIONS,
    type BdTrackingPluginOptions,
    DEFAULT_TRACKING_RATE_LIMITS,
    loggerCtx,
    type TrackingRateLimits,
} from './constants';

/**
 * Rate limits for order tracking, counted in the cache Redis. If Redis can't be reached, lookups
 * are allowed (and a warning logged): a shopper must always be able to see their order.
 */
@Injectable()
export class TrackingRateLimiter implements OnModuleDestroy {
    readonly rules: TrackingRateLimits;
    private readonly redis: Redis;
    private readonly store: RedisRateLimitStore;

    constructor(@Inject(BD_TRACKING_PLUGIN_OPTIONS) options: BdTrackingPluginOptions) {
        this.rules = { ...DEFAULT_TRACKING_RATE_LIMITS, ...options.rateLimits };
        // Connects on first use, so the worker process opens no connection.
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
            Logger.warn(`Tracking rate limit skipped (Redis unavailable): ${String(error)}`, loggerCtx);
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

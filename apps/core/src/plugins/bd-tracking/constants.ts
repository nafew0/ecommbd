import type { RateLimitRule } from '@ecommbd/shared';
import type { RedisConnectionOptions } from '../bd-checkout';

export const loggerCtx = 'BdTrackingPlugin';

export const BD_TRACKING_PLUGIN_OPTIONS = Symbol('BD_TRACKING_PLUGIN_OPTIONS');

export interface TrackingRateLimits {
    /** Lookups by order number and phone from one address (carrier NAT: a little generous). */
    perIp: RateLimitRule;
    /** Lookups naming one phone number, from anywhere. */
    perPhone: RateLimitRule;
    /** Token lookups (the SMS link) from one address. */
    tokenPerIp: RateLimitRule;
}

export const DEFAULT_TRACKING_RATE_LIMITS: TrackingRateLimits = {
    perIp: { limit: 20, windowMs: 10 * 60_000 },
    perPhone: { limit: 10, windowMs: 60 * 60_000 },
    tokenPerIp: { limit: 60, windowMs: 10 * 60_000 },
};

export interface BdTrackingPluginOptions {
    /** The cache Redis (allkeys-lru), where rate-limit counters live. */
    redis: RedisConnectionOptions;
    /** Prefix for this store's rate-limit keys, e.g. `s42:rl:`. */
    rateLimitKeyPrefix: string;
    rateLimits?: Partial<TrackingRateLimits>;
}

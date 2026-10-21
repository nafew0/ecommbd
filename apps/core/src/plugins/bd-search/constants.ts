import type { RateLimitRule } from '@ecommbd/shared';
import type { RedisConnectionOptions } from '../bd-checkout';

export const loggerCtx = 'BdSearchPlugin';

export const BD_SEARCH_PLUGIN_OPTIONS = Symbol('BD_SEARCH_PLUGIN_OPTIONS');

/** Key in Vendure's settings store. */
export const SEARCH_SETTINGS_KEY = 'bdSearch.settings';

export interface SearchRateLimits {
    /** Searches (results pages, category pages) per client IP. */
    search: RateLimitRule;
    /** Suggestion requests (typing in the search box) per client IP. */
    suggest: RateLimitRule;
}

/** Generous: many shoppers share one mobile-carrier address (SEARCH_RATE_LIMIT_PER_MINUTE). */
export const DEFAULT_SEARCH_RATE_LIMITS: SearchRateLimits = {
    search: { limit: 600, windowMs: 60_000 },
    suggest: { limit: 1200, windowMs: 60_000 },
};

/** Searches with no results: new terms recorded per day at most, and days kept. */
export const MISS_LIMITS = { newTermsPerDay: 1000, keepDays: 30 } as const;

/** Results per page at most (the storefront shows 24). */
export const MAX_TAKE = 48;

export interface BdSearchPluginOptions {
    /** The cache Redis (allkeys-lru), where rate-limit counters live. */
    redis: RedisConnectionOptions;
    /** Prefix for this store's rate-limit keys, e.g. `s42:rl:`. */
    rateLimitKeyPrefix: string;
    rateLimits?: Partial<SearchRateLimits>;
    /** How long a loaded catalog is reused, in ms (default 3000; tests use 0). */
    catalogCacheMs?: number;
}

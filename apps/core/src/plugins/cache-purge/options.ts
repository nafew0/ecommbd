import type { RedisConnectionOptions } from '../bd-checkout';
export const CACHE_OPTIONS = Symbol('CACHE_OPTIONS');
export interface CachePurgeOptions {
    storeId: string;
    redis: RedisConnectionOptions;
    redisKeyPrefix: string;
    purgeUrl?: string;
    purgeSecret?: string;
    storefrontUrl?: string;
    /** Direct local storefront URL for a bounded warm-up, through Varnish where configured. */
    warmUrl?: string;
    batchMs?: number;
    pollMs?: number;
}

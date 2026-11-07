import type { RedisConnectionOptions } from '../bd-checkout';

export const CACHE_OPTIONS = Symbol('CACHE_OPTIONS');

/** How the core keeps the storefront's caches fresh (roadmap phase 17), from plugins/index.ts. */
export interface CachePurgeOptions {
    /** Prefix of every cache tag, unique per store (stores may share one Varnish). */
    storeId: string;
    /** The cache Redis: the storefront's data cache, and the beacon's rate limits. */
    redis: RedisConnectionOptions;
    redisKeyPrefix: string;
    /** Varnish's purge listener (`CACHE_PURGE_URL`). Without it only the data cache is cleared. */
    purgeUrl?: string;
    purgeSecret?: string;
    /**
     * The store's public address. Speed beacons must come from this origin, and warm-up requests
     * go here, so they fill the same cache entries shoppers use (Varnish's key includes the Host).
     */
    storefrontUrl?: string;
    /** Request the store's top pages after a purge-all or a Varnish restart (`CACHE_WARM_UP`). */
    warmUp?: boolean;
    /** Milliseconds a change waits so that changes made together go out as one purge. Default 2 s. */
    batchMs?: number;
    /**
     * Listing pages are refreshed a second time this long after a catalog change, once Vendure's
     * search index (updated by the worker) has caught up. Default 10 s.
     */
    listingSettleMs?: number;
    /** bd-search keeps the catalog it reads from the index this long per process. Default 3 s. */
    listingCacheMs?: number;
    /** How often the worker looks for due purges, in milliseconds. Default 250. */
    pollMs?: number;
}

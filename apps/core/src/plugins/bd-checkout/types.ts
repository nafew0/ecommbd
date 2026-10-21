import type { CheckoutRateLimits } from './constants';

export interface RedisConnectionOptions {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

export interface BdCheckoutPluginOptions {
    /** The cache Redis (allkeys-lru), where rate-limit counters live. */
    redis: RedisConnectionOptions;
    /** Prefix for this store's rate-limit keys, e.g. `s42:rl:`. */
    rateLimitKeyPrefix: string;
    rateLimits?: Partial<CheckoutRateLimits>;
}

/** Customer source: how the customer first reached the store. */
export type CustomerSource = 'web' | 'manual' | 'import';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomCustomerFields {
        phone?: string | null;
        alternatePhone?: string | null;
        source?: CustomerSource;
        internalNotes?: string | null;
        orderCount?: number;
        deliveredCount?: number;
        returnedCount?: number;
        cancelledCount?: number;
        totalSpent?: number;
        lastOrderAt?: Date | null;
    }
    interface CustomOrderFields {
        customerNote?: string | null;
        contactEmail?: string | null;
        locale?: string | null;
    }
}

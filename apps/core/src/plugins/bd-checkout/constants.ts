import type { RateLimitRule } from '@ecommbd/shared';

export const BD_CHECKOUT_PLUGIN_OPTIONS = Symbol('BD_CHECKOUT_PLUGIN_OPTIONS');
export const loggerCtx = 'BdCheckoutPlugin';

/** Keys in Vendure's settings store. */
export const CHECKOUT_SETTINGS_KEY = 'bdCheckout.settings';

export interface CheckoutRateLimits {
    /** `setCustomerForOrderByPhone` per shopper session. */
    customerPerSession: RateLimitRule;
    /** `setCustomerForOrderByPhone` per phone number, across sessions (stops phone probing). */
    customerPerPhone: RateLimitRule;
    /** `setOrderShippingAddressBD` per shopper session. */
    addressPerSession: RateLimitRule;
}

const MINUTE = 60_000;

/** Generous for a real shopper fixing typos; tight for a script trying numbers. */
export const DEFAULT_RATE_LIMITS: CheckoutRateLimits = {
    customerPerSession: { limit: 20, windowMs: 10 * MINUTE },
    customerPerPhone: { limit: 20, windowMs: 60 * MINUTE },
    addressPerSession: { limit: 30, windowMs: 10 * MINUTE },
};

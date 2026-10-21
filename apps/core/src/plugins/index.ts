import type { StoreLanguage } from '@ecommbd/shared';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { BdCatalogPlugin } from './bd-catalog';
import { BdManualOrdersPlugin } from './bd-manual-orders';
import { BdCheckoutPlugin, type BdCheckoutPluginOptions, type RedisConnectionOptions } from './bd-checkout';
import { BdCorePlugin } from './bd-core';
import { BdOrdersPlugin } from './bd-orders';
import { FraudGuardPlugin } from './fraud-guard';
import { MerchantAdminPlugin } from './merchant-admin/merchant-admin.plugin';
import { NotificationsPlugin, type SmsDriver } from './notifications';
import { PaymentsBdPlugin } from './payments-bd';
import { ShippingBdPlugin } from './shipping-bd';

/** The built merchant admin (`npm run build -w @ecommbd/admin`), from `src/plugins` or `dist/plugins`. */
export const ADMIN_APP_DIR = path.join(__dirname, '../../../admin/dist');

export interface CustomPluginOptions {
    /** STORE_DEFAULT_LANGUAGE: the storefront's default language for a new store. */
    defaultLanguage: StoreLanguage;
    /** Set up store defaults on start (default true). */
    initializeOnBootstrap?: boolean;
    /** ASSET_URL_PREFIX, so the admin may show images from the asset server. */
    assetUrlPrefix?: string;
    /** The cache Redis (allkeys-lru), for rate limits. */
    cacheRedis: RedisConnectionOptions;
    /** REDIS_KEY_PREFIX: this store's Redis keys. */
    redisKeyPrefix: string;
    /** Rate limits for checkout (tests set low ones). */
    checkoutRateLimits?: BdCheckoutPluginOptions['rateLimits'];
    /** SMS_DRIVER: the SMS provider (the log driver records instead of sending). */
    smsDriver: SmsDriver;
    /** STOREFRONT_URL, for SMS tracking links. */
    storefrontUrl?: string;
}

/**
 * Our own Vendure plugins: every Bangladesh-specific feature lives in one of these
 * (docs/roadmap). Built here, not inline in vendure-config.ts, so end-to-end tests use exactly
 * the same list.
 */
export function customPlugins(options: CustomPluginOptions): NonNullable<VendureConfig['plugins']> {
    return [
        BdCorePlugin.init({
            defaultLanguage: options.defaultLanguage,
            initializeOnBootstrap: options.initializeOnBootstrap,
        }),
        BdCheckoutPlugin.init({
            redis: options.cacheRedis,
            rateLimitKeyPrefix: `${options.redisKeyPrefix}:rl:`,
            rateLimits: options.checkoutRateLimits,
        }),
        BdOrdersPlugin,
        ShippingBdPlugin,
        PaymentsBdPlugin,
        BdCatalogPlugin,
        BdManualOrdersPlugin,
        NotificationsPlugin.init({ driver: options.smsDriver, storefrontUrl: options.storefrontUrl }),
        FraudGuardPlugin,
        MerchantAdminPlugin.init({
            appDir: ADMIN_APP_DIR,
            imageOrigins: options.assetUrlPrefix ? [new URL(options.assetUrlPrefix).origin] : [],
        }),
    ];
}

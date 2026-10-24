import type { StoreLanguage } from '@ecommbd/shared';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { BdCatalogPlugin } from './bd-catalog';
import { BdManualOrdersPlugin } from './bd-manual-orders';
import { BdCheckoutPlugin, type BdCheckoutPluginOptions, type RedisConnectionOptions } from './bd-checkout';
import { BdContentPlugin } from './bd-content';
import { BdCorePlugin } from './bd-core';
import { BdImagesPlugin } from './bd-images';
import { BdOrdersPlugin } from './bd-orders';
import { BdPrintPlugin } from './bd-print';
import { FraudGuardPlugin } from './fraud-guard';
import { MerchantAdminPlugin } from './merchant-admin/merchant-admin.plugin';
import { NotificationsPlugin, type SmsDriver } from './notifications';
import { PaymentsBdPlugin } from './payments-bd';
import { PaymentsOnlinePlugin } from './payments-online';
import { CouriersPlugin } from './couriers';
import { MetaCapiPlugin } from './meta-capi';
import { ShippingBdPlugin } from './shipping-bd';
// Last: its store-defaults step runs after the others (the order files load in).
import { BdSearchPlugin, type SearchRateLimits } from './bd-search';
import { BdTrackingPlugin, type TrackingRateLimits } from './bd-tracking';
import { BdSectionsPlugin } from './bd-sections';
import { BdSalesPagesPlugin } from './bd-sales-pages';

/** The built merchant admin (`npm run build -w @ecommbd/admin`), from `src/plugins` or `dist/plugins`. */
export const ADMIN_APP_DIR = path.join(__dirname, '../../../admin/dist');

/** Default IMAGES_DIR: `apps/core/static/images`, next to Vendure's assets. */
export const DEFAULT_IMAGES_DIR = path.join(__dirname, '../../static/images');

export interface CustomPluginOptions {
    /** STORE_DEFAULT_LANGUAGE: the storefront's default language for a new store. */
    defaultLanguage: StoreLanguage;
    /** Set up store defaults on start (default true). */
    initializeOnBootstrap?: boolean;
    /** ASSET_URL_PREFIX, so the admin may show images from the asset server. */
    assetUrlPrefix?: string;
    /** IMAGES_DIR: where the WebP sizes are written. */
    imagesDir?: string;
    /** IMAGE_URL_PREFIX: where they are served from (default `/img`). */
    imageUrlPrefix?: string;
    /** The cache Redis (allkeys-lru), for rate limits. */
    cacheRedis: RedisConnectionOptions;
    /** REDIS_KEY_PREFIX: this store's Redis keys. */
    redisKeyPrefix: string;
    /** Rate limits for checkout (tests set low ones). */
    checkoutRateLimits?: BdCheckoutPluginOptions['rateLimits'];
    /** SMS_DRIVER: the SMS provider (the log driver records instead of sending). */
    smsDriver: SmsDriver;
    /** STOREFRONT_URL, for SMS tracking links and where payment gateways send shoppers back. */
    storefrontUrl?: string;
    /** SECRETS_KEYRING: encrypts payment gateway (and later courier) credentials. */
    secretsKeyring?: string;
    /** Tests only: payment gateways at a mock server. */
    gatewayBaseUrls?: Partial<Record<'sslcommerz' | 'bkash', string>>;
    /** Tests only: couriers at a mock server. */
    courierBaseUrls?: Partial<Record<'steadfast' | 'pathao', string>>;
    /** Tests only: Meta's Graph API at a mock server. */
    metaGraphUrl?: string;
    /** Rate limits for search (tests set high ones). */
    searchRateLimits?: Partial<SearchRateLimits>;
    /** How long search reuses a loaded catalog, in ms (tests use 0). */
    searchCatalogCacheMs?: number;
    /** Rate limits for order tracking (tests set low ones). */
    trackingRateLimits?: Partial<TrackingRateLimits>;
    /** Signs page preview links (COOKIE_SECRET). */
    previewSecret: string;
    /** Where preview links point (STOREFRONT_URL, or the storefront's dev address); relative without it. */
    previewStorefrontUrl?: string;
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
        BdPrintPlugin,
        BdContentPlugin,
        BdImagesPlugin.init({
            dir: options.imagesDir ?? DEFAULT_IMAGES_DIR,
            urlPrefix: options.imageUrlPrefix,
        }),
        ShippingBdPlugin,
        PaymentsBdPlugin,
        BdCatalogPlugin,
        BdManualOrdersPlugin,
        NotificationsPlugin.init({ driver: options.smsDriver, storefrontUrl: options.storefrontUrl }),
        FraudGuardPlugin,
        PaymentsOnlinePlugin.init({
            publicUrl: options.storefrontUrl,
            keyring: options.secretsKeyring,
            baseUrls: options.gatewayBaseUrls,
        }),
        CouriersPlugin.init({
            publicUrl: options.storefrontUrl,
            keyring: options.secretsKeyring,
            baseUrls: options.courierBaseUrls,
        }),
        MetaCapiPlugin.init({
            publicUrl: options.storefrontUrl,
            keyring: options.secretsKeyring,
            graphUrl: options.metaGraphUrl,
        }),
        MerchantAdminPlugin.init({
            appDir: ADMIN_APP_DIR,
            imageOrigins: options.assetUrlPrefix ? [new URL(options.assetUrlPrefix).origin] : [],
            frameOrigins: [options.previewStorefrontUrl ?? options.storefrontUrl]
                .filter((url): url is string => !!url)
                .map(url => new URL(url).origin),
        }),
        // Needs Vendure's DefaultSearchPlugin (vendure-config.ts), whose index it reads.
        BdSearchPlugin.init({
            redis: options.cacheRedis,
            rateLimitKeyPrefix: `${options.redisKeyPrefix}:rl:`,
            rateLimits: options.searchRateLimits,
            catalogCacheMs: options.searchCatalogCacheMs,
        }),
        BdTrackingPlugin.init({
            redis: options.cacheRedis,
            rateLimitKeyPrefix: `${options.redisKeyPrefix}:rl:`,
            rateLimits: options.trackingRateLimits,
        }),
        BdSectionsPlugin.init({
            secret: options.previewSecret,
            storefrontUrl: options.previewStorefrontUrl ?? options.storefrontUrl,
            redis: options.cacheRedis,
            redisKeyPrefix: options.redisKeyPrefix,
        }),
        // Uses bd-sections' layouts and bd-orders' permissions.
        BdSalesPagesPlugin.init({ storefrontUrl: options.previewStorefrontUrl ?? options.storefrontUrl }),
    ];
}

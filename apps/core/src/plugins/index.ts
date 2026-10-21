import type { StoreLanguage } from '@ecommbd/shared';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { BdCheckoutPlugin, type BdCheckoutPluginOptions, type RedisConnectionOptions } from './bd-checkout';
import { BdContentPlugin } from './bd-content';
import { BdCorePlugin } from './bd-core';
import { BdImagesPlugin } from './bd-images';
import { BdOrdersPlugin } from './bd-orders';
import { BdPrintPlugin } from './bd-print';
import { MerchantAdminPlugin } from './merchant-admin/merchant-admin.plugin';

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
        MerchantAdminPlugin.init({
            appDir: ADMIN_APP_DIR,
            imageOrigins: options.assetUrlPrefix ? [new URL(options.assetUrlPrefix).origin] : [],
        }),
    ];
}

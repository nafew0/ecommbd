import type { StoreLanguage } from '@ecommbd/shared';

export interface BdCorePluginOptions {
    /** The storefront's default language for a new store, chosen at setup (STORE_DEFAULT_LANGUAGE). */
    defaultLanguage: StoreLanguage;
    /**
     * Run the store-defaults initializer when the server starts. Default true. It only creates what
     * is missing, so this is safe on every start.
     */
    initializeOnBootstrap?: boolean;
}

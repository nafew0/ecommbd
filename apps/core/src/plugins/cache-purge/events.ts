import { RequestContext, VendureEvent } from '@vendure/core';

/**
 * "Something the storefront shows has changed": published by our own plugins (pages, menus,
 * settings, theme, layouts, sales pages) with the cache tags to refresh. The cache-purge plugin
 * writes it to its outbox in the same transaction. Server code only: no HTTP request or header can
 * ask for a purge or prevent one.
 */
export class StorefrontChangedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public tags: string[],
        /** Refresh the whole store and warm it up (a theme switch). */
        public all = false,
    ) {
        super();
    }
}

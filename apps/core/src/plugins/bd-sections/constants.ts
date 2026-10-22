import { PermissionDefinition } from '@vendure/core';
import type { RedisConnectionOptions } from '../bd-checkout';

export const loggerCtx = 'BdSectionsPlugin';

export const BD_SECTIONS_PLUGIN_OPTIONS = Symbol('BD_SECTIONS_PLUGIN_OPTIONS');

/** Key in Vendure's settings store. */
export const THEME_KEY = 'bdSections.theme';

export const editStorefrontPermission = new PermissionDefinition({
    name: 'EditStorefront',
    description: 'Design the storefront: theme, home page, page sections and the product page template',
});

/** Published versions kept per page for restoring. */
export const HISTORY_LIMIT = 20;

/** A stored layout's JSON may not be larger than this. */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

/** Saved sections a store may keep. */
export const MAX_SAVED_SECTIONS = 100;

/** How long preview links work, in minutes: the editor's frame (renewed while open) and shared links. */
export const PREVIEW_MINUTES = { editor: 15, share: 30 } as const;

export interface BdSectionsPluginOptions {
    /** Signs preview tokens (a key is derived from it; COOKIE_SECRET). */
    secret: string;
    /** The storefront's address for preview links; without it links are relative (same site). */
    storefrontUrl?: string;
    /** The cache Redis, where the storefront keeps its data cache (purged on publish). */
    redis: RedisConnectionOptions;
    /** REDIS_KEY_PREFIX: the storefront's cache keys live under `<prefix>:sf:`. */
    redisKeyPrefix: string;
}

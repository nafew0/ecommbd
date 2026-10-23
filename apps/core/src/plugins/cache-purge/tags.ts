import type { ID } from '@vendure/core';

/**
 * Cache tags: the names the storefront puts on every cached page (Varnish's `xkey` header) and
 * the core purges by. The storefront's half is apps/storefront/src/lib/cache-policy.ts; the two
 * lists must stay in step.
 *
 * - Every page: `store`, `settings`, `theme`, `menus` and `type:<kind>`. These describe what the
 *   layout around every page shows, so changing one of them refreshes the whole store.
 * - `listing`: pages that list products from the search index (home, categories, search
 *   suggestions, product grids in sections). Every catalog change refreshes them.
 * - `product:<id>` / `collection:<id>`: pages that show that product or category. `products`: any
 *   page that shows at least one product (the storefront adds it with the first `product:` tag).
 * - `pages`, `layouts`, `sales-pages`, `collections`: content pages, pages built from sections,
 *   sales pages, and pages whose header lists the top categories.
 */

/** Every cached page of the store. */
export const STORE_TAG = 'store';
export const LISTING_TAG = 'listing';
export const PRODUCTS_TAG = 'products';

/** What a change to prices or stock display everywhere refreshes: every page showing a product. */
export const PRICE_TAGS = [LISTING_TAG, PRODUCTS_TAG];

/**
 * More products than this in one change (a big collection's filters, a bulk edit): purge every
 * page that shows a product instead of naming each, so one purge header stays small.
 */
export const MAX_NAMED_PRODUCTS = 50;

/**
 * Varnish's default limit for one request header line is 8 KB (`http_req_hdr_len`). Purges whose
 * tag list would be longer than this become one purge of the whole store.
 */
export const MAX_PURGE_HEADER = 5500;

/** At most this many tags in one outbox row (a bad caller can't write an unbounded row). */
const MAX_TAGS_PER_ROW = 100;

/** Letters, digits and `:_*-`, as the VCL accepts in `X-Purge-Tags` (`*` is the data cache's "all"). */
const TAG = /^[a-zA-Z0-9:_*-]{1,80}$/;

/** The tags worth storing: well-formed, without repeats, at most 100. */
export function cleanTags(tags: string[]): string[] {
    return [...new Set(tags.filter(tag => TAG.test(tag)))].slice(0, MAX_TAGS_PER_ROW);
}

/** `product:<id>` for each product, or `products` when there are too many to name. */
export function productTags(ids: Iterable<ID>): string[] {
    const unique = [...new Set([...ids].map(String))];
    return unique.length > MAX_NAMED_PRODUCTS ? [PRODUCTS_TAG] : unique.map(id => `product:${id}`);
}

export interface Delivery {
    /** For Varnish's `X-Purge-Tags`: each tag with the store's prefix. */
    header: string;
    /** For the storefront's data cache in Redis: the same names, with "everything" spelled `*`. */
    dataTags: string[];
    /** True when the whole store is refreshed. */
    everything: boolean;
}

/**
 * What one delivery purges. Tags get the store's prefix, so stores sharing a Varnish never purge
 * each other. A purge-all, a `store` tag, or a list too long for one header becomes the store tag
 * alone (every page carries it).
 */
export function deliveryTags(storeId: string, tags: string[], all: boolean): Delivery {
    const scoped = tags.map(tag => `${storeId}:${tag}`).join(' ');
    const everything = all || tags.includes(STORE_TAG) || scoped.length > MAX_PURGE_HEADER;
    return everything
        ? { header: `${storeId}:${STORE_TAG}`, dataTags: ['*'], everything }
        : { header: scoped, dataTags: tags, everything };
}

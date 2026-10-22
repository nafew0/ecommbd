export const loggerCtx = 'BdSalesPagesPlugin';

/** The automatic promotion that gives sales page offers (packs and the add-on) their prices. */
export const OFFER_PROMOTION_NAME = 'Sales page offer';
export const OFFER_CONDITION_CODE = 'bd_sales_page_offer';
export const OFFER_ACTION_CODE = 'bd_sales_page_offer_discount';

/** The most of the product one sales page order takes without packs (with packs: the pack's quantity). */
export const MAX_ORDER_QUANTITY = 20;

/** Sales pages a store may have. */
export const MAX_SALES_PAGES = 500;

/** The storefront's cache tag for sales pages (apps/storefront/src/lib/cache.ts). */
export const SALES_PAGES_CACHE_TAG = 'sales-pages';

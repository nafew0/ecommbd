export const loggerCtx = 'MetaCapiPlugin';

export const META_OPTIONS = Symbol('META_OPTIONS');

/** Keys in Vendure's settings store. Tokens are encrypted and never readable through an API. */
export const META_SETTINGS_KEY = 'metaCapi.settings';
export const META_SECRETS_KEY = 'metaCapi.tokens';
/** Pixels whose events are held (a refused token or Pixel), shown in the admin until released. */
export const META_STATUS_KEY = 'metaCapi.status';

/** The storefront's events: `POST <STOREFRONT_URL>/bd-events` (proxied to the core). */
export const EVENTS_ROUTE = 'bd-events';

/**
 * Browser events per address a minute. A shopper makes a handful (a page view, a product view, an add
 * to cart); 120 still leaves room for many shoppers behind a carrier's shared address, and one
 * address can no longer fill the queue on its own.
 */
export const EVENT_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/**
 * Browser events for the whole store a minute, from all addresses together: below what one run of
 * the sending task sends per Pixel (`SEND_LIMITS`), so a flood can't build a backlog that never drains.
 */
export const STORE_EVENT_RATE_LIMIT = { limit: 3_000, windowMs: 60_000 };

/** How much one run of the sending task (every minute) does, so runs stay short and never overlap. */
export const SEND_LIMITS = {
    /** Batches (of up to 1,000 events) per Pixel per run. */
    batchesPerPixel: 5,
    /** Requests to Meta per Pixel per run, including the split batches that look for a bad event. */
    requestsPerPixel: 40,
    /** No new batch starts after this long; the task's own timeout (10 minutes) is far above it. */
    runBudgetMs: 40_000,
    /** Events taken by a run aren't due for anyone else this long, even if that run dies. */
    leaseMs: 10 * 60_000,
    /** Queued browser events kept per Pixel; older ones are skipped (Purchase is never skipped). */
    browserBacklog: 20_000,
} as const;

/** The sending task's timeout: well above a run's budget plus one slow request. */
export const SEND_TASK_TIMEOUT_MS = 10 * 60_000;

/** The storefront's events: at most this many bytes of JSON (a big cart's product data fits easily). */
export const EVENT_MAX_BYTES = 8_192;

/** Known bots, crawlers and test tools: their page views aren't shoppers. */
export const BOT_PATTERN =
    /bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|preview/i;

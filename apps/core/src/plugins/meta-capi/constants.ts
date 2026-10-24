export const loggerCtx = 'MetaCapiPlugin';

export const META_OPTIONS = Symbol('META_OPTIONS');

/** Keys in Vendure's settings store. Tokens are encrypted and never readable through an API. */
export const META_SETTINGS_KEY = 'metaCapi.settings';
export const META_SECRETS_KEY = 'metaCapi.tokens';
/** The latest token problem, shown in the admin until a send works again. */
export const META_STATUS_KEY = 'metaCapi.status';

/** The storefront's events: `POST <STOREFRONT_URL>/bd-events` (proxied to the core). */
export const EVENTS_ROUTE = 'bd-events';

/** Browser events per address a minute: plenty for real shoppers behind a carrier's shared address. */
export const EVENT_RATE_LIMIT = { limit: 600, windowMs: 60_000 };

/** Known bots, crawlers and test tools: their page views aren't shoppers. */
export const BOT_PATTERN =
    /bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|preview/i;

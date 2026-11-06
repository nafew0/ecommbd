/**
 * The page address that goes to Meta with an event (phase 20). Browser-safe and tiny, without zod:
 * the storefront's tracker imports it, and the core applies the same rule to what the browser sent.
 *
 * Some addresses carry secrets: the SMS tracking link (`/t/<token>/`), the payment hand-off
 * (`/checkout/pay/?to=<attempt>`), the thank-you page (`?order=<code>`, which shows the order to its
 * session). Meta, its Pixel script and our event log must never see them, so the query string is
 * dropped except for harmless campaign parameters, and secret path segments are replaced.
 */

/** Query parameters kept: campaign tags and Meta's own click ID. Everything else is dropped. */
export const META_URL_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
    'fbclid',
] as const;

/** `/en/…` or `/bn/…`: the language prefix of the non-default language. */
const LANG_PREFIX = /^\/(?:bn|en)(?=\/|$)/i;

/**
 * Pages that are never tracked at all, not even PageView: their address is a secret (tracking and
 * payment links) or they show only the shopper's own data.
 */
const PRIVATE_PATHS = [/^\/t\//, /^\/track\/?$/, /^\/checkout\/pay\/?$/, /^\/account\/?$/, /^\/bd-pay\//];

/** Path segments that are secrets, replaced before an address is sent or stored. */
const SECRET_SEGMENTS: ReadonlyArray<[RegExp, string]> = [
    // The tracking link's token: `/t/<token>/` → `/t/-/`.
    [/^((?:\/(?:bn|en))?\/t\/)[^/]+/i, '$1-'],
    // Payment routes carry attempt IDs and tracking tokens: `/bd-pay/…` → `/bd-pay/`.
    [/^((?:\/(?:bn|en))?\/bd-pay\/).*/i, '$1'],
];

/** Whether a page (its path, with or without the language prefix) is one we never track. */
export function isPrivateMetaPath(pathname: string): boolean {
    const path = pathname.replace(LANG_PREFIX, '') || '/';
    return PRIVATE_PATHS.some(pattern => pattern.test(path));
}

/**
 * The address as Meta may see it: no fragment, no login, only campaign parameters, secret segments
 * replaced. Null when it isn't an http(s) address.
 */
export function metaPageUrl(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const kept = new URLSearchParams();
    for (const name of META_URL_PARAMS) {
        const value = url.searchParams.get(name);
        if (value) kept.set(name, value.slice(0, 500));
    }
    let path = url.pathname;
    for (const [pattern, replacement] of SECRET_SEGMENTS) path = path.replace(pattern, replacement);
    const query = kept.toString();
    return `${url.origin}${path}${query ? `?${query}` : ''}`;
}

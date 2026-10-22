import { cleanText } from './text';

/**
 * Where an order came from (roadmap phase 16): the ad or link of the shopper's last visit that
 * wasn't direct, kept for 30 days in a first-party cookie by a tiny storefront script (cached pages
 * can't read the query string on the server), then copied onto the order when it's placed.
 *
 * Everything here is untrusted text from links anyone can craft: it's cleaned, cut to safe lengths
 * and stored as plain text, and the admin escapes it like any other text.
 */

export const ATTRIBUTION_COOKIE = 'bd_attr';
export const ATTRIBUTION_DAYS = 30;

/** Query parameters read from the landing URL, and their keys in `Attribution`. */
export const ATTRIBUTION_PARAMS = {
    utm_source: 'source',
    utm_medium: 'medium',
    utm_campaign: 'campaign',
    utm_content: 'content',
    utm_term: 'term',
    fbclid: 'fbclid',
    gclid: 'gclid',
    ttclid: 'ttclid',
} as const;

export const ATTRIBUTION_LIMITS = {
    /** UTM values. */
    text: 150,
    /** Click IDs are opaque and can be long. */
    clickId: 255,
    /** The referring site's host name. */
    referrer: 100,
    /** A sales page's ID. */
    salesPage: 40,
} as const;

export interface Attribution {
    source: string;
    medium: string;
    campaign: string;
    content: string;
    term: string;
    fbclid: string;
    gclid: string;
    ttclid: string;
    /** The other site that linked here (host name only), e.g. `m.facebook.com`. */
    referrer: string;
    /** The sales page the visit landed on, by its ID. */
    salesPage: string;
    /** When the visit happened, in ms since 1970. */
    at: number;
}

type TextKey = Exclude<keyof Attribution, 'at'>;

const TEXT_KEYS: readonly TextKey[] = [
    'source',
    'medium',
    'campaign',
    'content',
    'term',
    'fbclid',
    'gclid',
    'ttclid',
    'referrer',
    'salesPage',
];

const LIMIT: Record<TextKey, number> = {
    source: ATTRIBUTION_LIMITS.text,
    medium: ATTRIBUTION_LIMITS.text,
    campaign: ATTRIBUTION_LIMITS.text,
    content: ATTRIBUTION_LIMITS.text,
    term: ATTRIBUTION_LIMITS.text,
    fbclid: ATTRIBUTION_LIMITS.clickId,
    gclid: ATTRIBUTION_LIMITS.clickId,
    ttclid: ATTRIBUTION_LIMITS.clickId,
    referrer: ATTRIBUTION_LIMITS.referrer,
    salesPage: ATTRIBUTION_LIMITS.salesPage,
};

const one = (value: unknown, max: number) =>
    typeof value === 'string' ? cleanText(value.slice(0, max * 2)).slice(0, max) : '';

/** Stored or sent attribution read back; null when there's nothing in it. */
export function readAttribution(value: unknown): Attribution | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const result = { at: 0 } as Attribution;
    for (const key of TEXT_KEYS) result[key] = one(raw[key], LIMIT[key]);
    result.salesPage = /^[\w-]+$/.test(result.salesPage) ? result.salesPage : '';
    result.referrer = /^[a-z0-9.-]+$/i.test(result.referrer) ? result.referrer.toLowerCase() : '';
    const at = Number(raw.at);
    result.at = Number.isFinite(at) && at > 0 ? Math.floor(at) : 0;
    return TEXT_KEYS.some(key => result[key]) ? result : null;
}

/** An ad or another site, as opposed to typing the address or a bookmark. */
export function isDirect(attribution: Attribution | null): boolean {
    if (!attribution) return true;
    return !TEXT_KEYS.some(key => key !== 'salesPage' && attribution[key]);
}

/**
 * The visit described by a landing URL and `document.referrer`; null for a direct one. A referrer on
 * this site (`ownHost`) is no referrer.
 */
export function visitAttribution(
    url: URL,
    referrer: string,
    ownHost: string,
    salesPage = '',
    now = Date.now(),
): Attribution | null {
    const raw: Record<string, string | number> = { salesPage, at: now };
    for (const [param, key] of Object.entries(ATTRIBUTION_PARAMS)) {
        const value = url.searchParams.get(param);
        if (value) raw[key] = value;
    }
    try {
        const host = referrer ? new URL(referrer).hostname : '';
        if (host && host !== ownHost) raw.referrer = host;
    } catch {
        // Not a URL: no referrer.
    }
    const visit = readAttribution(raw);
    return isDirect(visit) ? null : visit;
}

/** What to keep after a visit: the new one unless it's direct, else what's stored while it's fresh. */
export function nextAttribution(
    stored: Attribution | null,
    visit: Attribution | null,
    now = Date.now(),
): Attribution | null {
    if (visit && !isDirect(visit)) return visit;
    if (!stored || now - stored.at > ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000) return null;
    return stored;
}

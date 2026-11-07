import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';

/**
 * Meta Pixel and the Conversions API (roadmap phase 20). Browser-safe: settings, the events, and
 * user data normalized the way Meta specifies before hashing (hashing is in `meta-hash.ts`, Node only).
 */

/** Pinned Graph API version. v26.0 came out 2026-07-29; Meta keeps a version about two years. */
export const META_GRAPH_VERSION = 'v26.0';
export const META_GRAPH_URL = 'https://graph.facebook.com';

export const META_EVENTS = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'] as const;
export type MetaEventName = (typeof META_EVENTS)[number];

/** Events the storefront reports. Purchase is only ever made by the server, from the order. */
export const BROWSER_EVENTS = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout'] as const;
export type BrowserEventName = (typeof BROWSER_EVENTS)[number];

export function isBrowserEvent(value: unknown): value is BrowserEventName {
    return (BROWSER_EVENTS as readonly unknown[]).includes(value);
}

/**
 * When Purchase is sent: when placed (an online order once paid), when staff confirm it, or when it's
 * delivered. Confirmed or delivered teaches ads to find real buyers, not fake COD orders.
 */
export const PURCHASE_TRIGGERS = ['placed', 'confirmed', 'delivered'] as const;
export type PurchaseTrigger = (typeof PURCHASE_TRIGGERS)[number];

export const PURCHASE_VALUES = ['withoutDelivery', 'withDelivery'] as const;

/** Meta takes up to 1,000 events a request, and website events at most 7 days old. */
export const META_LIMITS = { batch: 1000, maxAgeDays: 7, pixels: 2, testCode: 40 } as const;

export const metaSettingsSchema = z.object({
    enabled: z.boolean(),
    /** Load Meta's own script in the browser too (the same events, deduplicated by event ID). */
    browserPixel: z.boolean(),
    pixelIds: z
        .array(
            z
                .string()
                .trim()
                .regex(/^\d{5,20}$/, 'invalid'),
        )
        .max(META_LIMITS.pixels, 'tooMany')
        .transform(list => [...new Set(list)]),
    /** From Meta's Test Events tool; events then show there. Empty in normal use. */
    testEventCode: z.string().trim().max(META_LIMITS.testCode, 'tooLong'),
    purchaseTrigger: z.enum(PURCHASE_TRIGGERS),
    purchaseValue: z.enum(PURCHASE_VALUES),
    /** Phone and Messenger orders (phase 05) didn't come from an ad click on the site: off by default. */
    sendManualOrders: z.boolean(),
});

export type MetaSettings = z.output<typeof metaSettingsSchema>;

export function defaultMetaSettings(): MetaSettings {
    return {
        enabled: false,
        browserPixel: true,
        pixelIds: [],
        testEventCode: '',
        purchaseTrigger: 'confirmed',
        purchaseValue: 'withoutDelivery',
        sendManualOrders: false,
    };
}

export function parseMetaSettings(
    input: unknown,
): { ok: true; settings: MetaSettings } | { ok: false; errors: SettingsFieldError[] } {
    const result = metaSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** `+8801712345678` → `8801712345678`: digits with the country code, no plus. */
export function metaPhone(e164: string): string {
    return e164.replace(/\D/g, '');
}

/** Trimmed and lower-case. */
export function metaEmail(email: string): string {
    return email.trim().toLowerCase();
}

/**
 * A full name as Meta's `fn` and `ln`: lower-case, NFC, punctuation removed; the first word is the
 * first name, the rest the last name. Bangla names stay in Bangla (lower-casing leaves them as they are).
 */
export function metaName(fullName: string): { fn: string; ln: string } {
    const words = fullName
        .normalize('NFC')
        .toLowerCase()
        .replace(/[.,'"’()-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    return { fn: words[0] ?? '', ln: words.slice(1).join(' ') };
}

/** A city (our district): lower-case Latin letters only, no spaces ("Cox's Bazar" → "coxsbazar"). */
export function metaCity(name: string): string {
    return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** `_fbp` (`fb.1.<ms>.<random>`) and `_fbc` (`fb.1.<ms>.<fbclid>`), checked before we trust them. */
export const FBP_PATTERN = /^fb\.[0-2]\.\d{10,16}\.\d{1,20}$/;
export const FBC_PATTERN = /^fb\.[0-2]\.\d{10,16}\.[\w-]{1,500}$/;

/** The event ID for an order's Purchase: the same in the browser and on the server, so Meta keeps one. */
export function purchaseEventId(orderCode: string): string {
    return `purchase-${orderCode}`;
}

/**
 * The event ID for a checkout's InitiateCheckout: one per cart (its order code), so reloading the
 * checkout page doesn't count a new checkout.
 */
export function checkoutEventId(orderCode: string): string {
    return `checkout-${orderCode}`;
}

/**
 * What Meta's refusal means for sending:
 * - `token`: the token is revoked or expired (code 190, HTTP 401). Hold the Pixel's events.
 * - `pixel`: the whole Pixel is refused: a wrong Pixel ID or a token without permission for it
 *   (codes 10, 200–299 and 803, and 100 with subcode 33 "object does not exist or missing
 *   permissions"). Sending event by event can't help: hold the Pixel's events too.
 * - `retry`: Meta is busy or rate-limiting (HTTP 429 and 5xx; codes 1, 2, 4, 17, 32, 341, 613).
 * - `invalid`: something in the events themselves (code 100 and the rest): find the bad one.
 * Codes from Meta's Graph API error reference, from memory: check them when moving Graph versions.
 */
export type MetaErrorKind = 'token' | 'pixel' | 'retry' | 'invalid';

const RETRY_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export function classifyMetaError(status: number, code?: number, subcode?: number): MetaErrorKind {
    if (code === 190 || status === 401) return 'token';
    if (code === 10 || code === 803 || (code !== undefined && code >= 200 && code <= 299)) return 'pixel';
    if (code === 100 && subcode === 33) return 'pixel';
    if (status === 429 || status >= 500 || (code !== undefined && RETRY_CODES.has(code))) return 'retry';
    return 'invalid';
}

/**
 * Meta's `action_source` for an order, by where it came from: the storefront is `website`; orders
 * staff enter (phase 05) say how the shopper ordered. Values from Meta's Conversions API reference
 * (from memory): website, phone_call, chat, physical_store, system_generated, other.
 */
export function metaActionSource(orderSource: string | null | undefined): string {
    switch (orderSource ?? 'web') {
        case 'web':
            return 'website';
        case 'phone':
            return 'phone_call';
        case 'messenger':
        case 'whatsapp':
        case 'facebookComment':
            return 'chat';
        case 'walkIn':
            return 'physical_store';
        case 'import':
            return 'system_generated';
        default:
            return 'other';
    }
}

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

import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Order SMS (roadmap phase 10): the events, templates in Bangla and English, settings, and how
 * many SMS parts a message takes (what the merchant pays for).
 */

export const SMS_EVENTS = [
    'placed',
    'confirmed',
    'shipped',
    'delivered',
    'cancelled',
    'paymentVerified',
    'paymentRejected',
    'otp',
    'incomplete',
] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

export const SMS_VARIABLES = ['name', 'orderNumber', 'total', 'codDue', 'trackingUrl', 'storeName', 'storePhone'] as const;
export type SmsVariable = (typeof SMS_VARIABLES)[number] | 'code';
export type SmsLanguage = 'bn' | 'en';

export const SMS_LIMITS = { template: 600, senderId: 11 } as const;

// GSM 03.38: the basic set (1 unit each) and the extension table (2 units: escape + character).
const GSM_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegments {
    /** GSM-7 for plain English, UCS-2 (Unicode) for Bangla, emoji and anything else. */
    encoding: 'gsm7' | 'ucs2';
    /** Units counted: GSM-7 characters (extension characters count 2), or UTF-16 code units. */
    units: number;
    segments: number;
    /** Units per part for this length: 160/153 (GSM-7), 70/67 (Unicode). */
    perSegment: number;
}

/** How many SMS parts a message takes. Bangla is Unicode: 70 characters in one SMS, 67 per part when longer. */
export function smsSegments(text: string): SmsSegments {
    let gsm = true;
    let gsmUnits = 0;
    for (const character of text) {
        if (GSM_BASIC.includes(character)) gsmUnits += 1;
        else if (GSM_EXTENDED.includes(character)) gsmUnits += 2;
        else {
            gsm = false;
            break;
        }
    }
    if (gsm) {
        const perSegment = gsmUnits <= 160 ? 160 : 153;
        return { encoding: 'gsm7', units: gsmUnits, segments: Math.max(1, Math.ceil(gsmUnits / perSegment)), perSegment };
    }
    // UTF-16 code units: an emoji takes two.
    const units = text.length;
    const perSegment = units <= 70 ? 70 : 67;
    return { encoding: 'ucs2', units, segments: Math.max(1, Math.ceil(units / perSegment)), perSegment };
}

/** What a variable becomes when it has no value (a safe default, never "undefined"). */
const FALLBACKS: Record<SmsLanguage, Partial<Record<SmsVariable, string>>> = {
    bn: { name: 'গ্রাহক', storeName: 'আমাদের দোকান' },
    en: { name: 'Customer', storeName: 'our shop' },
};

/**
 * Fills `{name}`, `{orderNumber}`… Values are inserted as plain text, never interpreted; unknown
 * or empty variables use a safe default or disappear, and extra spaces are tidied.
 */
export function renderSmsTemplate(
    template: string,
    values: Partial<Record<SmsVariable, string | null | undefined>>,
    language: SmsLanguage,
): string {
    const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => {
        const value = values[key as SmsVariable];
        return value ? String(value) : (FALLBACKS[language][key as SmsVariable] ?? '');
    });
    return cleanText(filled, { multiline: true }).replace(/ +([.,।!?])/g, '$1');
}

const template = z
    .string()
    .transform(value => cleanText(value, { multiline: true }))
    .pipe(z.string().min(1, 'required').max(SMS_LIMITS.template, 'tooLong'));

const eventSettings = z.object({
    enabled: z.boolean(),
    /** Sent even to customers who opted out of SMS (the merchant decides what's essential). */
    required: z.boolean(),
    bn: template,
    en: template,
});

const hour = z.number().int('invalid').min(0, 'invalid').max(23, 'invalid');

export const smsSettingsSchema = z.object({
    /** The approved sender ID (masking), e.g. "RahimFashn"; empty: the provider's number. */
    senderId: z
        .string()
        .trim()
        .max(SMS_LIMITS.senderId, 'tooLong')
        .regex(/^[A-Za-z0-9 ]*$/, 'invalid'),
    events: z.object(Object.fromEntries(SMS_EVENTS.map(event => [event, eventSettings])) as Record<SmsEvent, typeof eventSettings>),
    /** No ordinary SMS in these Dhaka hours (they wait for the morning); OTPs are never delayed. */
    quietHours: z.object({ enabled: z.boolean(), startHour: hour, endHour: hour }),
    caps: z.object({
        /** Stops SMS pumping: at most this many SMS to one phone a day. */
        perPhonePerDay: z.number().int('invalid').min(1, 'invalid').max(100, 'invalid'),
        /** And the whole store a day (staff are alerted when reached). */
        perStorePerDay: z.number().int('invalid').min(1, 'invalid').max(100_000, 'invalid'),
    }),
    /** What one SMS part costs, in poisha, for the editor's cost preview. */
    costPerSegment: z.number().int('invalid').min(0, 'invalid').max(1000, 'invalid'),
});

export type SmsSettings = z.output<typeof smsSettingsSchema>;

const TEMPLATES: Record<SmsEvent, { bn: string; en: string }> = {
    // Sent by staff from Incomplete orders (phase 11).
    incomplete: {
        bn: '{name}, আপনার অর্ডারটি এখনো বাকি আছে। অর্ডার করতে কল করুন {storePhone}। {storeName}',
        en: '{name}, your order is still waiting. Call {storePhone} to place it. {storeName}',
    },
    placed: {
        bn: '{name}, আপনার অর্ডার #{orderNumber} পেয়েছি। মোট ৳{total}। শীঘ্রই কল করে কনফার্ম করব। {storeName}',
        en: '{name}, we received your order #{orderNumber}. Total Tk {total}. We will call to confirm. {storeName}',
    },
    confirmed: {
        bn: 'আপনার অর্ডার #{orderNumber} কনফার্ম হয়েছে। ডেলিভারিতে দিতে হবে ৳{codDue}। ধন্যবাদ, {storeName}',
        en: 'Your order #{orderNumber} is confirmed. Pay Tk {codDue} on delivery. Thank you, {storeName}',
    },
    shipped: {
        bn: 'আপনার অর্ডার #{orderNumber} পাঠানো হয়েছে। ডেলিভারিতে ৳{codDue}। ট্র্যাক করুন: {trackingUrl}',
        en: 'Your order #{orderNumber} is on its way. Pay Tk {codDue} on delivery. Track: {trackingUrl}',
    },
    delivered: {
        bn: 'আপনার অর্ডার #{orderNumber} ডেলিভারি হয়েছে। কেনাকাটার জন্য ধন্যবাদ, {storeName}',
        en: 'Your order #{orderNumber} was delivered. Thank you for shopping with {storeName}',
    },
    cancelled: {
        bn: 'আপনার অর্ডার #{orderNumber} বাতিল হয়েছে। প্রশ্ন থাকলে কল করুন {storePhone}। {storeName}',
        en: 'Your order #{orderNumber} was cancelled. Questions? Call {storePhone}. {storeName}',
    },
    paymentVerified: {
        bn: 'অর্ডার #{orderNumber} এর পেমেন্ট পেয়েছি। ধন্যবাদ, {storeName}',
        en: 'We received the payment for order #{orderNumber}. Thank you, {storeName}',
    },
    paymentRejected: {
        bn: 'অর্ডার #{orderNumber} এর পেমেন্ট মেলেনি। দয়া করে কল করুন {storePhone}। {storeName}',
        en: 'We could not match the payment for order #{orderNumber}. Please call {storePhone}. {storeName}',
    },
    otp: {
        bn: '{storeName}: আপনার কোড {code}। ৫ মিনিট কাজ করবে। কাউকে বলবেন না।',
        en: '{storeName}: your code is {code}. It works for 5 minutes. Do not share it.',
    },
};

/** Which events are on in a new store, and which are sent even to customers who opted out. */
const DEFAULT_ON: SmsEvent[] = ['placed', 'confirmed', 'shipped', 'paymentVerified', 'paymentRejected', 'otp', 'incomplete'];
const DEFAULT_REQUIRED: SmsEvent[] = ['confirmed', 'shipped', 'paymentRejected', 'otp'];

export function defaultSmsSettings(): SmsSettings {
    return {
        senderId: '',
        events: Object.fromEntries(
            SMS_EVENTS.map(event => [
                event,
                { enabled: DEFAULT_ON.includes(event), required: DEFAULT_REQUIRED.includes(event), ...TEMPLATES[event] },
            ]),
        ) as SmsSettings['events'],
        quietHours: { enabled: true, startHour: 22, endHour: 8 },
        caps: { perPhonePerDay: 10, perStorePerDay: 2000 },
        costPerSegment: 35,
    };
}

export type ParseSmsSettingsResult = { ok: true; settings: SmsSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseSmsSettings(input: unknown): ParseSmsSettingsResult {
    const result = smsSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** A random, unguessable tracking token (128 bits, URL-safe): `/t/<token>` shows one order's status. */
export function newTrackingToken(random: (bytes: Uint8Array) => Uint8Array): string {
    const bytes = random(new Uint8Array(16));
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

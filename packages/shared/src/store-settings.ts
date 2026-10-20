import { z } from 'zod';
import { parseBdMobile, parseBdPhone } from './phone';
import { cleanText } from './text';

/**
 * Store settings: one schema for the server (which validates and stores them) and the merchant
 * admin (which validates the form before sending). Parsing also normalizes: text is cleaned,
 * phone numbers become E.164 (Bangla digits accepted), links get `https://`.
 *
 * Validation messages are codes, not sentences, so each app shows them in Bangla or English.
 */

export const SETTINGS_ERROR_CODES = [
    'required',
    'tooLong',
    'tooMany',
    'invalid',
    'invalidPhone',
    'invalidMobile',
    'invalidEmail',
    'invalidUrl',
    'notFound',
] as const;

export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];

export const STORE_LANGUAGES = ['bn', 'en'] as const;
export type StoreLanguage = (typeof STORE_LANGUAGES)[number];

/** Field limits, also used by the admin for `maxLength`. */
export const SETTINGS_LIMITS = {
    storeName: 100,
    addressLine: 300,
    area: 120,
    shortDescription: 300,
    businessHours: 200,
    tradeLicence: 50,
    policy: 20_000,
    url: 500,
    phones: 3,
} as const;

const text = (max: number, options: { multiline?: boolean } = {}) =>
    z
        .string()
        .transform(value => cleanText(value, options))
        .pipe(z.string().max(max, 'tooLong'));

const bilingual = (max: number, options: { multiline?: boolean } = {}) =>
    z.object({ bn: text(max, options), en: text(max, options) });

const phone = (kind: 'mobile' | 'any') =>
    z.string().transform((value, context) => {
        if (!value.trim()) {
            return '';
        }
        const result = kind === 'mobile' ? parseBdMobile(value) : parseBdPhone(value);
        if (!result.ok) {
            context.addIssue({
                code: 'custom',
                message: kind === 'mobile' ? 'invalidMobile' : 'invalidPhone',
            });
            return z.NEVER;
        }
        return result.phone.e164;
    });

const link = z.string().transform((value, context) => {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = URL.canParse(withScheme) ? new URL(withScheme) : undefined;
    if (!url || !['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) {
        context.addIssue({ code: 'custom', message: 'invalidUrl' });
        return z.NEVER;
    }
    if (url.href.length > SETTINGS_LIMITS.url) {
        context.addIssue({ code: 'custom', message: 'tooLong' });
        return z.NEVER;
    }
    return url.href;
});

const email = z
    .string()
    .transform(value => value.trim().toLowerCase())
    .refine(value => value === '' || z.email().safeParse(value).success, 'invalidEmail');

const policy = z.object({
    bn: text(SETTINGS_LIMITS.policy, { multiline: true }),
    en: text(SETTINGS_LIMITS.policy, { multiline: true }),
    /** Still our pre-filled template: the admin asks the merchant to review it. */
    isTemplate: z.boolean(),
});

const address = z
    .object({
        line: text(SETTINGS_LIMITS.addressLine, { multiline: true }),
        area: text(SETTINGS_LIMITS.area),
        districtId: z.string().trim().max(16),
        thanaId: z.string().trim().max(16),
    })
    .superRefine((value, context) => {
        if (value.districtId && !value.thanaId) {
            context.addIssue({ code: 'custom', path: ['thanaId'], message: 'required' });
        }
        if (value.thanaId && !value.districtId) {
            context.addIssue({ code: 'custom', path: ['districtId'], message: 'required' });
        }
    });

export const storeSettingsSchema = z.object({
    profile: z.object({
        storeName: bilingual(SETTINGS_LIMITS.storeName).refine(name => name.bn !== '' || name.en !== '', {
            message: 'required',
        }),
        logoAssetId: z.string().max(40).nullable(),
        faviconAssetId: z.string().max(40).nullable(),
        phones: z
            .array(phone('any'))
            .max(SETTINGS_LIMITS.phones, 'tooMany')
            .transform(list => list.filter(Boolean)),
        whatsapp: phone('mobile'),
        messengerUrl: link,
        email,
        address,
        tradeLicenceNumber: text(SETTINGS_LIMITS.tradeLicence),
        social: z.object({ facebook: link, instagram: link, youtube: link, tiktok: link }),
        businessHours: bilingual(SETTINGS_LIMITS.businessHours),
        shortDescription: bilingual(SETTINGS_LIMITS.shortDescription, { multiline: true }),
        /** Private: the owner's own mobile, for order alerts and account recovery. Never sent to shoppers. */
        ownerPhone: phone('mobile'),
    }),
    policies: z.object({
        returnPolicy: policy,
        refundPolicy: policy,
        privacyPolicy: policy,
        terms: policy,
    }),
    locale: z.object({
        defaultLanguage: z.enum(STORE_LANGUAGES),
        /** Show prices and numbers with Bangla digits (৳১,২৫০) on the storefront. */
        banglaDigits: z.boolean(),
        /** `numeric` 21/10/2026, `long` 21 October 2026 / ২১ অক্টোবর ২০২৬. */
        dateFormat: z.enum(['numeric', 'long']),
    }),
});

/** What the admin sends (before normalization). */
export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;
/** What is stored and returned. */
export type StoreSettings = z.output<typeof storeSettingsSchema>;
export type PolicyKey = keyof StoreSettings['policies'];

export const POLICY_KEYS: readonly PolicyKey[] = ['returnPolicy', 'refundPolicy', 'privacyPolicy', 'terms'];

/** Fields that never leave the Admin API. Everything else is public (sent to the storefront). */
export const PRIVATE_STORE_SETTINGS_FIELDS = ['profile.ownerPhone'] as const;

export type PublicStoreSettings = Omit<StoreSettings, 'profile'> & {
    profile: Omit<StoreSettings['profile'], 'ownerPhone'>;
};

/** Removes private fields. The Shop API sends only what this returns. */
export function toPublicStoreSettings(settings: StoreSettings): PublicStoreSettings {
    const { ownerPhone, ...profile } = settings.profile;
    return { ...settings, profile };
}

const emptyBilingual = () => ({ bn: '', en: '' });
const emptyPolicy = () => ({ bn: '', en: '', isTemplate: false });

/** Blank settings. The server fills the policy templates and store name on first use. */
export function emptyStoreSettings(defaultLanguage: StoreLanguage = 'bn'): StoreSettings {
    return {
        profile: {
            storeName: emptyBilingual(),
            logoAssetId: null,
            faviconAssetId: null,
            phones: [],
            whatsapp: '',
            messengerUrl: '',
            email: '',
            address: { line: '', area: '', districtId: '', thanaId: '' },
            tradeLicenceNumber: '',
            social: { facebook: '', instagram: '', youtube: '', tiktok: '' },
            businessHours: emptyBilingual(),
            shortDescription: emptyBilingual(),
            ownerPhone: '',
        },
        policies: {
            returnPolicy: emptyPolicy(),
            refundPolicy: emptyPolicy(),
            privacyPolicy: emptyPolicy(),
            terms: emptyPolicy(),
        },
        locale: { defaultLanguage, banglaDigits: false, dateFormat: 'numeric' },
    };
}

export interface SettingsFieldError {
    /** Dotted path, e.g. `profile.phones.1` or `profile.storeName`. */
    path: string;
    code: SettingsErrorCode;
}

export type ParseStoreSettingsResult =
    { ok: true; settings: StoreSettings } | { ok: false; errors: SettingsFieldError[] };

/** Validates and normalizes settings, returning field errors as codes instead of throwing. */
export function parseStoreSettings(input: unknown): ParseStoreSettingsResult {
    const result = storeSettingsSchema.safeParse(input);
    if (result.success) {
        return { ok: true, settings: result.data };
    }
    return {
        ok: false,
        errors: result.error.issues.map(issue => ({
            path: issue.path.join('.'),
            code: (SETTINGS_ERROR_CODES as readonly string[]).includes(issue.message)
                ? (issue.message as SettingsErrorCode)
                : 'invalid',
        })),
    };
}

/** Dotted paths of the values that differ, for the change history (`profile.phones`, `locale.banglaDigits`). */
export function changedSettingsPaths(before: unknown, after: unknown, prefix = ''): string[] {
    const isObject = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);
    if (isObject(before) && isObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        return keys.flatMap(key =>
            changedSettingsPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key),
        );
    }
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
}

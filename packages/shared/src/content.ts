import { z } from 'zod';
import type { PolicyKey } from './store-settings';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Storefront content (roadmap phase 12): simple pages and the header and footer menus. One schema
 * for the server and the merchant admin, like the store settings.
 */

/** Where the storefront shows each store-settings policy. Pages can't take these slugs. */
export const POLICY_SLUGS: Record<PolicyKey, string> = {
    returnPolicy: 'return-policy',
    refundPolicy: 'refund-policy',
    privacyPolicy: 'privacy-policy',
    terms: 'terms',
};

/** First path segments the storefront, the core or Nginx already use. */
export const RESERVED_SLUGS: readonly string[] = [
    'product',
    'product-category',
    'search',
    'cart',
    'checkout',
    'track',
    't',
    // Sales pages (phase 16): /s/<slug>/.
    's',
    'account',
    'bn',
    'en',
    'img',
    'assets',
    'shop-api',
    'admin-api',
    'admin',
    'dashboard',
    'health',
    'mailbox',
    'sitemap.xml',
    'robots.txt',
    ...Object.values(POLICY_SLUGS),
];

export const CONTENT_LIMITS = {
    title: 150,
    slug: 120,
    body: 100_000,
    seoTitle: 70,
    seoDescription: 200,
    menuLabel: 60,
    menuItems: 30,
    menuChildren: 15,
    url: 500,
} as const;

/**
 * A URL slug the way Vendure makes them (its `normalizeString`): Unicode NFD, Latin accents
 * removed, lowercase, punctuation dropped, spaces as `-`. Bangla letters stay, so a Bangla title
 * gives a Bangla slug.
 */
export function toSlug(input: string): string {
    return cleanText(input)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[!"£$%^&*()+[\]{};:@#~?\\/,.|><`¬'=‘’“”©®™।]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}

const text = (max: number) =>
    z
        .string()
        .transform(value => cleanText(value))
        .pipe(z.string().max(max, 'tooLong'));

const pageTranslation = z
    .object({
        title: text(CONTENT_LIMITS.title),
        slug: z.string().max(CONTENT_LIMITS.slug * 2, 'tooLong'),
        body: z.string().max(CONTENT_LIMITS.body, 'tooLong'),
        seoTitle: text(CONTENT_LIMITS.seoTitle),
        seoDescription: text(CONTENT_LIMITS.seoDescription),
    })
    .transform(value => ({ ...value, slug: toSlug(value.slug || value.title) }))
    .superRefine((value, context) => {
        if (value.slug.length > CONTENT_LIMITS.slug) {
            context.addIssue({ code: 'custom', path: ['slug'], message: 'tooLong' });
        }
        if (value.title && RESERVED_SLUGS.includes(value.slug)) {
            context.addIssue({ code: 'custom', path: ['slug'], message: 'reserved' });
        }
        if (!value.title && (value.body.trim() || value.seoTitle || value.seoDescription)) {
            context.addIssue({ code: 'custom', path: ['title'], message: 'required' });
        }
    });

/** A page as the admin sends it. A language with no title is left out of the storefront. */
export const pageInputSchema = z
    .object({
        enabled: z.boolean(),
        translations: z.object({ bn: pageTranslation, en: pageTranslation }),
    })
    .superRefine((value, context) => {
        if (!value.translations.bn.title && !value.translations.en.title) {
            context.addIssue({ code: 'custom', path: ['translations', 'bn', 'title'], message: 'required' });
        }
    });

export type PageInput = z.output<typeof pageInputSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: SettingsFieldError[] };

export function parsePageInput(input: unknown): ParseResult<PageInput> {
    const result = pageInputSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export const MENU_LOCATIONS = ['header', 'footer'] as const;
export type MenuLocation = (typeof MENU_LOCATIONS)[number];

const menuLabel = z
    .object({ bn: text(CONTENT_LIMITS.menuLabel), en: text(CONTENT_LIMITS.menuLabel) })
    .refine(label => label.bn !== '' || label.en !== '', { message: 'required' });

const menuUrl = z.string().transform((value, context) => {
    const trimmed = value.trim();
    const absolute = /^https?:\/\//i.test(trimmed) && URL.canParse(trimmed);
    // A path on this store, e.g. `/product-category/saree/`, or a full http(s) URL.
    const relative = /^\/(?!\/)[^\s]*$/.test(trimmed);
    if (!absolute && !relative) {
        context.addIssue({ code: 'custom', message: 'invalidUrl' });
        return z.NEVER;
    }
    if (trimmed.length > CONTENT_LIMITS.url) {
        context.addIssue({ code: 'custom', message: 'tooLong' });
        return z.NEVER;
    }
    return trimmed;
});

const menuLink = z.discriminatedUnion('type', [
    z.object({ type: z.literal('page'), id: z.string().min(1, 'required').max(40) }),
    z.object({ type: z.literal('category'), id: z.string().min(1, 'required').max(40) }),
    z.object({ type: z.literal('product'), id: z.string().min(1, 'required').max(40) }),
    z.object({
        type: z.literal('policy'),
        policy: z.enum(['returnPolicy', 'refundPolicy', 'privacyPolicy', 'terms']),
    }),
    z.object({ type: z.literal('url'), url: menuUrl }),
]);

export type MenuLink = z.output<typeof menuLink>;

const menuChild = z.object({ label: menuLabel, link: menuLink });

const menuItem = z.object({
    label: menuLabel,
    link: menuLink,
    children: z.array(menuChild).max(CONTENT_LIMITS.menuChildren, 'tooMany'),
});

/** Header and footer menus: up to two levels. Links to pages, categories and products store IDs. */
export const menusSchema = z.object({
    header: z.array(menuItem).max(CONTENT_LIMITS.menuItems, 'tooMany'),
    footer: z.array(menuItem).max(CONTENT_LIMITS.menuItems, 'tooMany'),
});

export type Menus = z.output<typeof menusSchema>;
export type MenuItem = Menus['header'][number];

export function parseMenus(input: unknown): ParseResult<Menus> {
    const result = menusSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

const POLICY_LABELS: Record<PolicyKey, { bn: string; en: string }> = {
    returnPolicy: { bn: 'রিটার্ন নীতি', en: 'Return policy' },
    refundPolicy: { bn: 'রিফান্ড নীতি', en: 'Refund policy' },
    privacyPolicy: { bn: 'প্রাইভেসি নীতি', en: 'Privacy policy' },
    terms: { bn: 'শর্তাবলি', en: 'Terms and conditions' },
};

/** A new store's menus: an empty header (the storefront then lists the top categories) and the policies in the footer. */
export function defaultMenus(): Menus {
    return {
        header: [],
        footer: (Object.keys(POLICY_LABELS) as PolicyKey[]).map(policy => ({
            label: POLICY_LABELS[policy],
            link: { type: 'policy', policy },
            children: [],
        })),
    };
}

export function policyLabel(policy: PolicyKey, language: 'bn' | 'en'): string {
    return POLICY_LABELS[policy][language];
}

/**
 * A slug as it goes in a URL: composed Unicode (NFC, as browsers and WooCommerce write it), then
 * percent-encoded. Vendure stores slugs decomposed (NFD), so lookups use `slug.normalize('NFD')`.
 */
export function encodeSlug(slug: string): string {
    return encodeURIComponent(slug.normalize('NFC'));
}

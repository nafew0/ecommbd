import { z } from 'zod';
import { isWholeTaka, takaToMinor } from './money';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * The one-page product form (roadmap phase 05; fields from docs/research/reference-bd-admin.md):
 * one schema for the server, which saves it in one go, and the merchant admin, which checks it
 * before sending. Amounts are poisha, always whole taka.
 */

export const VARIATION_TYPES = ['none', 'size', 'colour', 'pack', 'custom'] as const;
export type VariationType = (typeof VARIATION_TYPES)[number];

export const STOCK_REASONS = ['recount', 'received', 'damaged', 'gift', 'returned', 'other'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const CATALOG_LIMITS = {
    name: 150,
    shortDescription: 300,
    description: 10_000,
    gallery: 10,
    feedback: 20,
    variants: 50,
    sku: 64,
    option: 60,
    seoTitle: 70,
    seoDescription: 160,
    maxPrice: takaToMinor(1_00_00_000),
    maxStock: 1_000_000,
    maxGrams: 1_000_000,
} as const;

const text = (max: number, options: { multiline?: boolean } = {}) =>
    z
        .string()
        .transform(value => cleanText(value, options))
        .pipe(z.string().max(max, 'tooLong'));

const bilingual = (max: number, options: { multiline?: boolean } = {}) =>
    z.object({ bn: text(max, options), en: text(max, options) });

const money = z
    .number()
    .int('invalid')
    .min(0, 'invalid')
    .max(CATALOG_LIMITS.maxPrice, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');

const id = z.string().trim().min(1).max(40);

/** YouTube links only (watch, youtu.be, shorts); normalized to https. Empty is fine. */
export function parseYoutubeUrl(input: string): string | null {
    const value = input.trim();
    if (!value) return '';
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (!URL.canParse(withScheme)) return null;
    const url = new URL(withScheme);
    const host = url.hostname.replace(/^(www\.|m\.)/, '');
    if (!['youtube.com', 'youtu.be'].includes(host)) return null;
    url.protocol = 'https:';
    return url.href;
}

const youtube = z.string().transform((value, context) => {
    const parsed = parseYoutubeUrl(value);
    if (parsed === null) {
        context.addIssue({ code: 'custom', message: 'invalidUrl' });
        return z.NEVER;
    }
    return parsed;
});

const variantSchema = z.object({
    id: id.nullable(),
    /** The option's name, e.g. "XL", "লাল", "২ পিস". Empty without variations. */
    option: bilingual(CATALOG_LIMITS.option),
    sku: text(CATALOG_LIMITS.sku),
    price: money.refine(value => value > 0, 'required'),
    /** The struck-through "was" price; must be more than the price. */
    oldPrice: money.nullable(),
    stock: z.number().int('invalid').min(0, 'invalid').max(CATALOG_LIMITS.maxStock, 'invalid'),
    assetId: id.nullable(),
    isDefault: z.boolean(),
    enabled: z.boolean(),
    /** Pre-orders: sell when out of stock. */
    allowBackorder: z.boolean(),
    weightGrams: z
        .number()
        .int('invalid')
        .min(0, 'invalid')
        .max(CATALOG_LIMITS.maxGrams, 'invalid')
        .nullable(),
});

export const productFormSchema = z
    .object({
        id: id.nullable(),
        name: bilingual(CATALOG_LIMITS.name),
        shortDescription: bilingual(CATALOG_LIMITS.shortDescription, { multiline: true }),
        description: bilingual(CATALOG_LIMITS.description, { multiline: true }),
        enabled: z.boolean(),
        featuredAssetId: id.nullable(),
        galleryAssetIds: z.array(id).max(CATALOG_LIMITS.gallery, 'tooMany'),
        feedbackAssetIds: z.array(id).max(CATALOG_LIMITS.feedback, 'tooMany'),
        youtubeUrl: youtube,
        featured: z.boolean(),
        isNew: z.boolean(),
        categoryId: id.nullable(),
        delivery: z.object({
            free: z.boolean(),
            insideDhaka: money.nullable(),
            outsideDhaka: money.nullable(),
            /** Extra per item (heavy or fragile). */
            surcharge: money,
        }),
        seo: z.object({
            title: bilingual(CATALOG_LIMITS.seoTitle),
            description: bilingual(CATALOG_LIMITS.seoDescription, { multiline: true }),
        }),
        variationType: z.enum(VARIATION_TYPES),
        /** With `custom`: what the options are, e.g. "Flavour". */
        variationName: bilingual(CATALOG_LIMITS.option),
        variants: z.array(variantSchema).min(1, 'required').max(CATALOG_LIMITS.variants, 'tooMany'),
    })
    .superRefine((value, context) => {
        if (!value.name.bn && !value.name.en) {
            context.addIssue({ code: 'custom', path: ['name', 'bn'], message: 'required' });
        }
        if (value.variationType === 'none' && value.variants.length !== 1) {
            context.addIssue({ code: 'custom', path: ['variants'], message: 'invalid' });
        }
        if (value.variationType === 'custom' && !value.variationName.bn && !value.variationName.en) {
            context.addIssue({ code: 'custom', path: ['variationName', 'bn'], message: 'required' });
        }
        const seen = new Set<string>();
        value.variants.forEach((variant, index) => {
            if (value.variationType !== 'none') {
                const key = (variant.option.en || variant.option.bn).toLowerCase();
                if (!key) {
                    context.addIssue({
                        code: 'custom',
                        path: ['variants', index, 'option', 'bn'],
                        message: 'required',
                    });
                } else if (seen.has(key)) {
                    context.addIssue({
                        code: 'custom',
                        path: ['variants', index, 'option', 'bn'],
                        message: 'invalid',
                    });
                }
                seen.add(key);
            }
            if (variant.oldPrice !== null && variant.oldPrice <= variant.price) {
                context.addIssue({
                    code: 'custom',
                    path: ['variants', index, 'oldPrice'],
                    message: 'invalid',
                });
            }
        });
    })
    .transform(value => {
        // Exactly one default variant: the first marked one, or the first.
        const first = Math.max(
            0,
            value.variants.findIndex(variant => variant.isDefault),
        );
        return {
            ...value,
            variants: value.variants.map((variant, index) => ({ ...variant, isDefault: index === first })),
        };
    });

export type ProductForm = z.output<typeof productFormSchema>;
export type ProductFormVariant = ProductForm['variants'][number];

export type ParseProductFormResult =
    { ok: true; product: ProductForm } | { ok: false; errors: SettingsFieldError[] };

export function parseProductForm(input: unknown): ParseProductFormResult {
    const result = productFormSchema.safeParse(input);
    return result.success
        ? { ok: true, product: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export function emptyVariant(): ProductFormVariant {
    return {
        id: null,
        option: { bn: '', en: '' },
        sku: '',
        price: 0,
        oldPrice: null,
        stock: 0,
        assetId: null,
        isDefault: false,
        enabled: true,
        allowBackorder: false,
        weightGrams: null,
    };
}

export function emptyProductForm(): ProductForm {
    return {
        id: null,
        name: { bn: '', en: '' },
        shortDescription: { bn: '', en: '' },
        description: { bn: '', en: '' },
        enabled: true,
        featuredAssetId: null,
        galleryAssetIds: [],
        feedbackAssetIds: [],
        youtubeUrl: '',
        featured: false,
        isNew: false,
        categoryId: null,
        delivery: { free: false, insideDhaka: null, outsideDhaka: null, surcharge: 0 },
        seo: { title: { bn: '', en: '' }, description: { bn: '', en: '' } },
        variationType: 'none',
        variationName: { bn: '', en: '' },
        variants: [{ ...emptyVariant(), isDefault: true }],
    };
}

/**
 * A URL slug from an English name: `Cotton Panjabi (Blue)` → `cotton-panjabi-blue`. Bangla-only
 * names give an empty slug; the server then makes one from the product's ID.
 */
export function slugify(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

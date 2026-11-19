import { z } from 'zod';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Brands (roadmap phase 55): values of the `brand` facet, with a logo and a description. The
 * brand's code is its address: /brand/<code>.
 */

export const BRAND_LIMITS = { name: 80, code: 60, description: 2000, brands: 500 } as const;

export interface BrandInput {
    id: string | null;
    name: { bn: string; en: string };
    /** The address part. Empty: made from the English name, or `brand-<n>` for a Bangla-only one. */
    code: string;
    description: { bn: string; en: string };
    logoAssetId: string | null;
}

/** `Bashundhara Tissue` → `bashundhara-tissue`. Bangla-only text gives ''. */
export function brandCode(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, BRAND_LIMITS.code);
}

const text = (max: number, multiline = false) =>
    z
        .string()
        .transform(value => cleanText(value, { multiline }))
        .pipe(z.string().max(max, 'tooLong'));

const brandSchema = z
    .object({
        id: z.string().trim().max(40).nullable().default(null),
        name: z.object({ bn: text(BRAND_LIMITS.name), en: text(BRAND_LIMITS.name) }),
        code: z
            .string()
            .default('')
            .transform(value => brandCode(value)),
        description: z
            .object({ bn: text(BRAND_LIMITS.description, true), en: text(BRAND_LIMITS.description, true) })
            .default({ bn: '', en: '' }),
        logoAssetId: z.string().trim().max(40).nullable().default(null),
    })
    .superRefine((value, context) => {
        if (!value.name.bn && !value.name.en) {
            context.addIssue({ code: 'custom', path: ['name', 'bn'], message: 'required' });
        }
    })
    .transform(value => ({ ...value, code: value.code || brandCode(value.name.en) }));

export type ParseBrandResult = { ok: true; brand: BrandInput } | { ok: false; errors: SettingsFieldError[] };

export function parseBrandInput(input: unknown): ParseBrandResult {
    const result = brandSchema.safeParse(input);
    return result.success
        ? { ok: true, brand: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

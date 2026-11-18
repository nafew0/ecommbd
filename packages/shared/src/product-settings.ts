import { z } from 'zod';
import { isWholeTaka, takaToMinor } from './money';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Product depth (roadmap phase 55): status, units, shipping classes and the product number
 * prefix. Brands are a Vendure facet (`brand`), so they are not here.
 */

/**
 * What the merchant chooses on the product form. Trash is not chosen here: it is a separate
 * action, restorable for `TRASH_DAYS`.
 * - published: on sale (Vendure `enabled`)
 * - draft: not ready yet
 * - archived: no longer sold, kept for records and past orders
 */
export const PRODUCT_STATUSES = ['published', 'draft', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** What the product list can show. `trash` is a product moved to the trash. */
export const PRODUCT_LIST_STATUSES = [...PRODUCT_STATUSES, 'trash'] as const;
export type ProductListStatus = (typeof PRODUCT_LIST_STATUSES)[number];

export const TRASH_DAYS = 30;

/**
 * The status a product shows. `enabled` stays the one switch the storefront reads, so a product
 * edited anywhere else (Vendure's Dashboard, an import) can't end up half published.
 * The stored `status` only says why a product that is not enabled is off: draft or archived.
 */
export function productStatusOf(product: {
    enabled: boolean;
    status?: string | null;
    trashedAt?: Date | string | null;
}): ProductListStatus {
    if (product.trashedAt) return 'trash';
    if (product.enabled) return 'published';
    return product.status === 'archived' ? 'archived' : 'draft';
}

/** When a product in the trash is deleted for good. */
export function trashExpiresAt(trashedAt: Date): Date {
    return new Date(trashedAt.getTime() + TRASH_DAYS * 24 * 60 * 60 * 1000);
}

export interface UnitName {
    bn: string;
    en: string;
}

/** Built-in units. A product with no unit shows none, as before phase 55. */
export const DEFAULT_UNITS: ReadonlyArray<{ code: string; name: UnitName }> = [
    { code: 'piece', name: { bn: 'পিস', en: 'piece' } },
    { code: 'kg', name: { bn: 'কেজি', en: 'kg' } },
    { code: 'gram', name: { bn: 'গ্রাম', en: 'gram' } },
    { code: 'litre', name: { bn: 'লিটার', en: 'litre' } },
    { code: 'dozen', name: { bn: 'ডজন', en: 'dozen' } },
    { code: 'set', name: { bn: 'সেট', en: 'set' } },
];

export const PRODUCT_SETTINGS_LIMITS = {
    units: 20,
    classes: 20,
    name: 40,
    prefix: 6,
    maxCharge: takaToMinor(10_000),
    maxCm: 10_000,
} as const;

export interface ProductUnit {
    code: string;
    name: UnitName;
}

export interface ShippingClass {
    code: string;
    name: UnitName;
    /** Added once to the delivery charge of an order that has this class in it. Whole taka. */
    charge: number;
}

export interface ProductSettings {
    /** Prefix of a SKU the shop leaves empty: "P" → P12-1 (product 12, first variation). */
    skuPrefix: string;
    /** Units the shop adds to the built-in ones. */
    customUnits: ProductUnit[];
    shippingClasses: ShippingClass[];
}

export function defaultProductSettings(): ProductSettings {
    return { skuPrefix: 'P', customUnits: [], shippingClasses: [] };
}

const name = z
    .object({
        bn: z.string().transform(value => cleanText(value)),
        en: z.string().transform(value => cleanText(value)),
    })
    .superRefine((value, context) => {
        if (!value.bn && !value.en) context.addIssue({ code: 'custom', path: ['bn'], message: 'required' });
        if (value.bn.length > PRODUCT_SETTINGS_LIMITS.name || value.en.length > PRODUCT_SETTINGS_LIMITS.name) {
            context.addIssue({ code: 'custom', path: ['bn'], message: 'tooLong' });
        }
    });

/** Lower-case ASCII code: `Bulky Box` → `bulky-box`. Bangla-only text gives ''. */
function codeOf(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/** Brands are values of this Vendure facet (public, so search offers it as a filter). */
export const BRAND_FACET_CODE = 'brand';

/** Settings store key (Vendure's settings store), read by the catalog and by delivery. */
export const PRODUCT_SETTINGS_KEY = 'bdCatalog.productSettings';

/** A stable code: the one given, or one made from the English (then Bangla) name. */
const code = z
    .string()
    .optional()
    .transform(value => codeOf(value ?? ''));

const charge = z
    .number()
    .int('invalid')
    .min(0, 'invalid')
    .max(PRODUCT_SETTINGS_LIMITS.maxCharge, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');

function withCode<T extends { code: string; name: UnitName }>(items: T[], prefix: string): T[] {
    const used = new Set<string>();
    return items.map((item, index) => {
        let next = item.code || codeOf(item.name.en) || `${prefix}-${index + 1}`;
        while (used.has(next)) next = `${next}-${index + 1}`;
        used.add(next);
        return { ...item, code: next };
    });
}

const settingsSchema = z
    .object({
        skuPrefix: z.string().transform(value =>
            cleanText(value)
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, PRODUCT_SETTINGS_LIMITS.prefix),
        ),
        customUnits: z
            .array(z.object({ code, name }))
            .max(PRODUCT_SETTINGS_LIMITS.units, 'tooMany')
            .transform(items => withCode(items, 'unit')),
        shippingClasses: z
            .array(z.object({ code, name, charge }))
            .max(PRODUCT_SETTINGS_LIMITS.classes, 'tooMany')
            .transform(items => withCode(items, 'class')),
    })
    .superRefine((value, context) => {
        // A custom unit may not take a built-in unit's code, or products would show the wrong name.
        value.customUnits.forEach((unit, index) => {
            if (DEFAULT_UNITS.some(builtIn => builtIn.code === unit.code)) {
                context.addIssue({ code: 'custom', path: ['customUnits', index, 'name', 'bn'], message: 'taken' });
            }
        });
        if (!value.skuPrefix) context.addIssue({ code: 'custom', path: ['skuPrefix'], message: 'required' });
    });

export type ParseProductSettingsResult =
    { ok: true; settings: ProductSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseProductSettings(input: unknown): ParseProductSettingsResult {
    const result = settingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** Every unit the shop can pick: the built-in ones, then its own. */
export function allUnits(settings: Pick<ProductSettings, 'customUnits'>): ProductUnit[] {
    return [...DEFAULT_UNITS.map(unit => ({ code: unit.code, name: { ...unit.name } })), ...settings.customUnits];
}

/**
 * A unit's name in the shopper's or merchant's language, or null when the product has no unit
 * or the unit was removed from the settings (the product then shows none, never a code).
 */
export function unitName(
    unitCode: string | null | undefined,
    settings: Pick<ProductSettings, 'customUnits'>,
    language: 'bn' | 'en',
): string | null {
    if (!unitCode) return null;
    const unit = allUnits(settings).find(item => item.code === unitCode);
    if (!unit) return null;
    return unit.name[language] || unit.name.bn || unit.name.en || null;
}

/**
 * The extra delivery charge for the shipping classes in an order: each class counts once,
 * however many items have it. A class that was removed from the settings adds nothing.
 */
export function shippingClassCharge(
    classCodes: ReadonlyArray<string | null | undefined>,
    classes: ReadonlyArray<Pick<ShippingClass, 'code' | 'charge'>>,
): number {
    const distinct = new Set(classCodes.filter((value): value is string => !!value));
    let total = 0;
    for (const item of classes) if (distinct.has(item.code)) total += item.charge;
    return total;
}

/** The SKU a variation gets when the shop leaves it empty. */
export function autoSku(prefix: string, productId: string | number, position: number): string {
    return `${prefix || 'P'}${productId}-${position}`;
}

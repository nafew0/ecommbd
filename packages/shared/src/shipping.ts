import { z } from 'zod';
import { isWholeTaka, percentOfWholeTaka, takaToMinor } from './money';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';

/**
 * Delivery charges (roadmap phase 07, Vendure's settings store `shippingBd.settings`): one schema
 * for the server and the merchant admin, and the calculator both the checkout and manual orders use.
 *
 * Amounts are poisha (integers) and always whole taka. Zones are bd-geo's delivery zones.
 */

export const SHIPPING_ZONES = ['dhaka_city', 'dhaka_suburb', 'chattogram_city', 'outside_dhaka'] as const;
export type ShippingZone = (typeof SHIPPING_ZONES)[number];

export const DELIVERY_METHODS = ['standard', 'express', 'pickup'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Highest delivery charge, surcharge or threshold the form accepts. */
export const SHIPPING_LIMITS = {
    maxCharge: takaToMinor(10_000),
    maxThreshold: takaToMinor(10_00_000),
    maxGrams: 1_000_000,
    maxCodFeePercent: 10,
    overrides: 600,
    collections: 50,
} as const;

const money = (max: number = SHIPPING_LIMITS.maxCharge) =>
    z
        .number()
        .int('invalid')
        .min(0, 'invalid')
        .max(max, 'invalid')
        .refine(value => isWholeTaka(value), 'invalid');

const grams = z.number().int('invalid').min(0, 'invalid').max(SHIPPING_LIMITS.maxGrams, 'invalid');
const geoId = z.string().trim().min(1, 'required').max(16, 'invalid');

const perZone = <T extends z.ZodType>(value: T) =>
    z.object({ dhaka_city: value, dhaka_suburb: value, chattogram_city: value, outside_dhaka: value });

export const shippingSettingsSchema = z.object({
    /** The merchant saved the form at least once (until then the admin says the values are suggestions). */
    confirmed: z.boolean(),
    standard: z.object({
        rates: perZone(money()),
        /** Charge Chattogram city its own rate; when off, it pays the outside-Dhaka rate. */
        chattogramCityRate: z.boolean(),
    }),
    /** Rates for single districts or thanas, replacing the zone's standard rate. */
    overrides: z
        .array(z.object({ kind: z.enum(['district', 'thana']), id: geoId, rate: money() }))
        .max(SHIPPING_LIMITS.overrides, 'tooMany')
        .superRefine((list, context) => {
            const seen = new Set<string>();
            list.forEach((override, index) => {
                const key = `${override.kind}:${override.id}`;
                if (seen.has(key)) {
                    context.addIssue({ code: 'custom', path: [index, 'id'], message: 'invalid' });
                }
                seen.add(key);
            });
        }),
    /** Free standard delivery when the subtotal (after discounts, before delivery) reaches this; null: never. */
    freeAbove: perZone(money(SHIPPING_LIMITS.maxThreshold).nullable()),
    /** Products in these collections deliver free (like the product's own "free delivery" switch). */
    freeCollectionIds: z.array(z.string().trim().min(1).max(40)).max(SHIPPING_LIMITS.collections, 'tooMany'),
    express: z.object({
        enabled: z.boolean(),
        /** null: no express delivery to that zone. */
        rates: perZone(money().nullable()),
    }),
    pickup: z.object({ enabled: z.boolean() }),
    weight: z.object({
        enabled: z.boolean(),
        /** Weight included in the delivery charge. */
        includedGrams: grams,
        /** Added for every started kilogram above that. */
        perKg: money(),
    }),
    /** Charge for collecting cash, shown as its own line (applied by the COD payment, phase 08). */
    codFee: z.object({
        enabled: z.boolean(),
        type: z.enum(['flat', 'percent']),
        flat: money(),
        percent: z.number().min(0, 'invalid').max(SHIPPING_LIMITS.maxCodFeePercent, 'invalid'),
    }),
    coverage: z.object({
        /** Zones delivered to (at least one). */
        zones: z
            .array(z.enum(SHIPPING_ZONES))
            .min(1, 'required')
            .transform(list => [...new Set(list)]),
        /** Only these districts; empty: every district in those zones. */
        districtIds: z.array(geoId).max(64, 'tooMany'),
        /** Heaviest order delivered; null: no limit. */
        maxWeightGrams: grams.nullable(),
    }),
});

export type ShippingSettings = z.output<typeof shippingSettingsSchema>;

/** Typical BD charges, shown to the merchant as suggestions to confirm. */
export function defaultShippingSettings(): ShippingSettings {
    return {
        confirmed: false,
        standard: {
            rates: {
                dhaka_city: takaToMinor(60),
                dhaka_suburb: takaToMinor(100),
                chattogram_city: takaToMinor(120),
                outside_dhaka: takaToMinor(120),
            },
            chattogramCityRate: false,
        },
        overrides: [],
        freeAbove: { dhaka_city: null, dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
        freeCollectionIds: [],
        express: {
            enabled: false,
            rates: { dhaka_city: takaToMinor(120), dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
        },
        pickup: { enabled: false },
        weight: { enabled: false, includedGrams: 1000, perKg: takaToMinor(20) },
        codFee: { enabled: false, type: 'percent', flat: 0, percent: 1 },
        coverage: { zones: [...SHIPPING_ZONES], districtIds: [], maxWeightGrams: null },
    };
}

/** The threshold suggested when the merchant turns free delivery on. */
export const SUGGESTED_FREE_ABOVE = takaToMinor(2000);

export type ParseShippingSettingsResult =
    { ok: true; settings: ShippingSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseShippingSettings(input: unknown): ParseShippingSettingsResult {
    const result = shippingSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** One cart line, with what the calculator needs from its product and variant. */
export interface DeliveryLine {
    quantity: number;
    /** The variant's weight; null when the merchant didn't enter one (counted as 0 g). */
    weightGrams: number | null;
    /** The product's "free delivery" switch, or the product is in a free-delivery collection. */
    freeDelivery: boolean;
    /** The product's own charges; null: the store's rate. */
    insideDhaka: number | null;
    outsideDhaka: number | null;
    /** Extra charge per unit (heavy or fragile items). */
    surcharge: number;
}

export interface DeliveryQuoteInput {
    method: DeliveryMethod;
    /** From bd-geo `zoneOf()`; undefined when the address has no usable district (or Dhaka without a thana). */
    zone: ShippingZone | undefined;
    districtId?: string;
    thanaId?: string;
    /** Order subtotal after discounts, before delivery. */
    subTotal: number;
    lines: readonly DeliveryLine[];
}

export const DELIVERY_UNAVAILABLE_REASONS = ['METHOD_OFF', 'NO_DISTRICT', 'NOT_DELIVERED_HERE', 'TOO_HEAVY'] as const;
export type DeliveryUnavailableReason = (typeof DELIVERY_UNAVAILABLE_REASONS)[number];

export type DeliveryQuote =
    | {
          ok: true;
          price: number;
          /** Free because of the threshold or free-delivery products. */
          free: boolean;
          base: number;
          weightSurcharge: number;
          productSurcharge: number;
      }
    | { ok: false; reason: DeliveryUnavailableReason };

/** Chattogram city pays the outside-Dhaka rate unless the merchant gave it its own. */
function rateZone(settings: ShippingSettings, zone: ShippingZone): ShippingZone {
    return zone === 'chattogram_city' && !settings.standard.chattogramCityRate ? 'outside_dhaka' : zone;
}

export function totalWeightGrams(lines: readonly DeliveryLine[]): number {
    return lines.reduce((sum, line) => sum + (line.weightGrams ?? 0) * line.quantity, 0);
}

/**
 * The delivery charge of a cart for one method, or why that method can't deliver it.
 *
 * Standard delivery: each product's charge is its own inside/outside-Dhaka charge, or the store's
 * rate (a thana override, else a district override, else the zone's rate); free-delivery products
 * count as 0, and the highest charge in the cart applies. Weight and product surcharges come on
 * top. Reaching the zone's free-delivery threshold, or a cart of only free-delivery products, makes
 * the whole charge 0. Express has its own zone rates plus the surcharges, and is never free. Store
 * pickup is always 0.
 */
export function quoteDelivery(settings: ShippingSettings, input: DeliveryQuoteInput): DeliveryQuote {
    const { method, zone, lines } = input;
    if ((method === 'express' && !settings.express.enabled) || (method === 'pickup' && !settings.pickup.enabled)) {
        return { ok: false, reason: 'METHOD_OFF' };
    }
    if (method === 'pickup') {
        return { ok: true, price: 0, free: false, base: 0, weightSurcharge: 0, productSurcharge: 0 };
    }
    if (!zone) {
        return { ok: false, reason: 'NO_DISTRICT' };
    }
    const { coverage } = settings;
    const outsideCoverage =
        !coverage.zones.includes(zone) ||
        (coverage.districtIds.length > 0 && !coverage.districtIds.includes(input.districtId ?? ''));
    if (outsideCoverage) {
        return { ok: false, reason: 'NOT_DELIVERED_HERE' };
    }
    const weight = totalWeightGrams(lines);
    if (coverage.maxWeightGrams !== null && weight > coverage.maxWeightGrams) {
        return { ok: false, reason: 'TOO_HEAVY' };
    }
    const priceZone = rateZone(settings, zone);

    let base: number;
    if (method === 'express') {
        const rate = settings.express.rates[priceZone];
        if (rate === null) {
            return { ok: false, reason: 'NOT_DELIVERED_HERE' };
        }
        base = rate;
    } else {
        const storeRate = storeStandardRate(settings, priceZone, input.districtId, input.thanaId);
        const charges = lines.map(line => {
            if (line.freeDelivery) {
                return 0;
            }
            const own = zone === 'dhaka_city' ? line.insideDhaka : line.outsideDhaka;
            return own ?? storeRate;
        });
        base = charges.length ? Math.max(...charges) : storeRate;
    }

    const { weight: weightRule } = settings;
    const extraKg = weightRule.enabled ? Math.ceil(Math.max(0, weight - weightRule.includedGrams) / 1000) : 0;
    const weightSurcharge = extraKg * weightRule.perKg;
    const productSurcharge = lines.reduce(
        (sum, line) => sum + (line.freeDelivery ? 0 : line.surcharge * line.quantity),
        0,
    );

    if (method === 'standard') {
        const threshold = settings.freeAbove[priceZone];
        const allFree = lines.length > 0 && lines.every(line => line.freeDelivery);
        if (allFree || (threshold !== null && input.subTotal >= threshold)) {
            return { ok: true, price: 0, free: true, base, weightSurcharge, productSurcharge };
        }
    }
    return {
        ok: true,
        price: base + weightSurcharge + productSurcharge,
        free: false,
        base,
        weightSurcharge,
        productSurcharge,
    };
}

function storeStandardRate(
    settings: ShippingSettings,
    zone: ShippingZone,
    districtId: string | undefined,
    thanaId: string | undefined,
): number {
    const thana = thanaId && settings.overrides.find(o => o.kind === 'thana' && o.id === thanaId);
    if (thana) {
        return thana.rate;
    }
    const district = districtId && settings.overrides.find(o => o.kind === 'district' && o.id === districtId);
    return district ? district.rate : settings.standard.rates[zone];
}

/**
 * How much more the shopper must spend for free standard delivery ("Spend ৳X more"): 0 once
 * reached, null when the zone has no threshold (or the zone isn't known yet).
 */
export function freeDeliveryRemaining(
    settings: ShippingSettings,
    zone: ShippingZone | undefined,
    subTotal: number,
): { threshold: number; remaining: number } | null {
    if (!zone) {
        return null;
    }
    const threshold = settings.freeAbove[rateZone(settings, zone)];
    return threshold === null ? null : { threshold, remaining: Math.max(0, threshold - subTotal) };
}

/** The COD fee for an amount collected on delivery, in whole taka; 0 when the fee is off. */
export function codFee(settings: ShippingSettings, codDue: number): number {
    const fee = settings.codFee;
    if (!fee.enabled || codDue <= 0) {
        return 0;
    }
    return fee.type === 'flat' ? fee.flat : percentOfWholeTaka(codDue, fee.percent);
}

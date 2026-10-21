import { z } from 'zod';
import { isWholeTaka, percentOfWholeTaka, takaToMinor } from './money';
import { parseBdMobile } from './phone';
import { SHIPPING_ZONES, type ShippingZone } from './shipping';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { banglaToAsciiDigits } from './text';

/**
 * Payments (roadmap phase 08, Vendure's settings store `paymentsBd.settings`): cash on delivery,
 * bKash/Nagad/Rocket "Send Money" checked by staff, and a partial advance with the rest on
 * delivery. Amounts are poisha, always whole taka.
 */

export const MFS_PROVIDERS = ['bkash', 'nagad', 'rocket'] as const;
export type MfsProvider = (typeof MFS_PROVIDERS)[number];

/** How the merchant's number takes money: "Send Money" to a personal number, "Payment" to a merchant one, "Cash Out" to an agent. */
export const MFS_ACCOUNT_TYPES = ['personal', 'merchant', 'agent'] as const;
export type MfsAccountType = (typeof MFS_ACCOUNT_TYPES)[number];

export const ADVANCE_RULES = ['delivery', 'fixed', 'percent'] as const;
export type AdvanceRule = (typeof ADVANCE_RULES)[number];

/** Which COD orders must pay an advance. `risky` is filled in by fraud protection (phase 11). */
export const ADVANCE_SCOPES = ['all', 'outsideDhaka', 'products', 'risky'] as const;
export type AdvanceScope = (typeof ADVANCE_SCOPES)[number];

/** Why staff reject a mobile banking payment. `other` needs a note. */
export const PAYMENT_REJECT_REASONS = [
    'notReceived',
    'wrongAmount',
    'wrongNumber',
    'duplicate',
    'other',
] as const;
export type PaymentRejectReason = (typeof PAYMENT_REJECT_REASONS)[number];

/** How staff gave money back. */
export const REFUND_METHODS = ['bkash', 'nagad', 'rocket', 'cash', 'bank'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const PAYMENT_LIMITS = {
    maxAmount: takaToMinor(100_00_000),
    maxPercent: 100,
    ids: 200,
    reminderHours: { min: 1, max: 72 },
} as const;

const money = z
    .number()
    .int('invalid')
    .min(0, 'invalid')
    .max(PAYMENT_LIMITS.maxAmount, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');

const mobile = z.string().transform((value, context) => {
    if (!value.trim()) {
        return '';
    }
    const parsed = parseBdMobile(value);
    if (!parsed.ok) {
        context.addIssue({ code: 'custom', message: 'invalidMobile' });
        return z.NEVER;
    }
    return parsed.phone.e164;
});

const account = z
    .object({ enabled: z.boolean(), number: mobile, accountType: z.enum(MFS_ACCOUNT_TYPES) })
    .superRefine((value, context) => {
        if (value.enabled && !value.number) {
            context.addIssue({ code: 'custom', path: ['number'], message: 'required' });
        }
    });

const ids = z.array(z.string().trim().min(1).max(40)).max(PAYMENT_LIMITS.ids, 'tooMany');

export const paymentSettingsSchema = z.object({
    cod: z.object({
        enabled: z.boolean(),
        /** Highest order total accepted as COD; null: no limit. */
        maxOrderTotal: money.nullable(),
        /** Zones where COD is offered; empty: everywhere. */
        zones: z.array(z.enum(SHIPPING_ZONES)).transform(list => [...new Set(list)]),
    }),
    mfs: z.object({ bkash: account, nagad: account, rocket: account }),
    advance: z.object({
        enabled: z.boolean(),
        rule: z.enum(ADVANCE_RULES),
        fixed: money,
        percent: z.number().min(1, 'invalid').max(PAYMENT_LIMITS.maxPercent, 'invalid'),
        scope: z.enum(ADVANCE_SCOPES),
        /** With scope `products`: orders with any of these products or collections. */
        productIds: ids,
        collectionIds: ids,
    }),
    /** Staff are reminded of payments still unchecked after this many hours. */
    reminderHours: z
        .number()
        .int('invalid')
        .min(PAYMENT_LIMITS.reminderHours.min, 'invalid')
        .max(PAYMENT_LIMITS.reminderHours.max, 'invalid'),
});

export type PaymentSettings = z.output<typeof paymentSettingsSchema>;

/** COD on; mobile banking off until the merchant enters their numbers; no advance. */
export function defaultPaymentSettings(): PaymentSettings {
    const off = { enabled: false, number: '', accountType: 'personal' as const };
    return {
        cod: { enabled: true, maxOrderTotal: null, zones: [] },
        mfs: { bkash: { ...off }, nagad: { ...off }, rocket: { ...off } },
        advance: {
            enabled: false,
            rule: 'delivery',
            fixed: takaToMinor(200),
            percent: 10,
            scope: 'all',
            productIds: [],
            collectionIds: [],
        },
        reminderHours: 6,
    };
}

export type ParsePaymentSettingsResult =
    { ok: true; settings: PaymentSettings } | { ok: false; errors: SettingsFieldError[] };

export function parsePaymentSettings(input: unknown): ParsePaymentSettingsResult {
    const result = paymentSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** What decides whether an order may pay by COD, and whether it needs an advance. */
export interface PaymentOrderFacts {
    /** Order total, delivery and COD fee included. */
    total: number;
    /** The delivery charge (for the "delivery charge in advance" rule). */
    delivery: number;
    zone: ShippingZone | undefined;
    productIds: readonly string[];
    collectionIds: readonly string[];
    /** Fraud protection says this phone is risky (phase 11). */
    risky: boolean;
}

export type CodRefusal = 'COD_OFF' | 'COD_OVER_LIMIT' | 'COD_NOT_HERE';

/** Why COD can't be offered for this order, or null when it can. Blocked phones are checked by fraud protection. */
export function codRefusal(settings: PaymentSettings, order: PaymentOrderFacts): CodRefusal | null {
    const { cod } = settings;
    if (!cod.enabled) {
        return 'COD_OFF';
    }
    if (cod.maxOrderTotal !== null && order.total > cod.maxOrderTotal) {
        return 'COD_OVER_LIMIT';
    }
    if (cod.zones.length > 0 && (!order.zone || !cod.zones.includes(order.zone))) {
        return 'COD_NOT_HERE';
    }
    return null;
}

/**
 * The advance a COD order must pay first, or 0 when none is needed. Whole taka, never more than
 * the total; the rest is paid on delivery and makes up the exact total.
 */
export function advanceAmount(settings: PaymentSettings, order: PaymentOrderFacts): number {
    const { advance } = settings;
    if (!advance.enabled || order.total <= 0) {
        return 0;
    }
    const inScope =
        advance.scope === 'all' ||
        (advance.scope === 'outsideDhaka' && order.zone !== 'dhaka_city' && order.zone !== 'dhaka_suburb') ||
        (advance.scope === 'products' &&
            (order.productIds.some(id => advance.productIds.includes(id)) ||
                order.collectionIds.some(id => advance.collectionIds.includes(id)))) ||
        (advance.scope === 'risky' && order.risky);
    if (!inScope) {
        return 0;
    }
    const amount =
        advance.rule === 'delivery'
            ? order.delivery
            : advance.rule === 'fixed'
              ? advance.fixed
              : percentOfWholeTaka(order.total, advance.percent);
    return Math.min(Math.max(amount, 0), order.total);
}

/** Mobile banking accounts the shopper can pay to. */
export function enabledMfsProviders(settings: PaymentSettings): MfsProvider[] {
    return MFS_PROVIDERS.filter(provider => settings.mfs[provider].enabled && settings.mfs[provider].number);
}

/**
 * A transaction ID as typed by a shopper: trimmed, spaces removed, Bangla digits converted,
 * uppercase. Returns null unless it's 8–12 letters and digits (lenient: providers' formats change).
 */
export function normalizeTransactionId(input: string): string | null {
    const text = banglaToAsciiDigits(input)
        .replace(/[\s-]+/g, '')
        .toUpperCase();
    return /^[A-Z0-9]{8,12}$/.test(text) ? text : null;
}

/** The unique key of a transaction (`bkash:8N7A6D5E4F`): one TrxID can pay one order only. */
export function mfsReference(provider: MfsProvider, transactionId: string): string {
    return `${provider}:${transactionId}`;
}

const LOOKALIKES: Record<string, string> = {
    O: '0',
    '0': 'O',
    I: '1',
    '1': 'I',
    L: '1',
    S: '5',
    '5': 'S',
    B: '8',
    '8': 'B',
};

/**
 * Characters staff may misread in a TrxID (O/0, I/1, S/5, B/8), for a "check carefully" hint.
 * Never used to change what the shopper typed.
 */
export function lookalikeCharacters(transactionId: string): string[] {
    return [...new Set([...transactionId].filter(character => character in LOOKALIKES))];
}

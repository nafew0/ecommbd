import { z } from 'zod';
import { isWholeTaka, roundToWholeTaka, takaToMinor } from './money';
import { formatOrderNumber } from './order-settings';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { cleanText } from './text';

/**
 * Purchases and suppliers (roadmap phase 52). Money is integer poisha, whole taka.
 * A supplier's balance is worked out from the records, never stored on its own.
 */

export const PURCHASE_STATUSES = ['draft', 'ordered', 'partial', 'received'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const COST_METHODS = ['average', 'latest'] as const;
export type CostMethod = (typeof COST_METHODS)[number];

export const PURCHASE_LIMITS = {
    name: 150,
    address: 500,
    note: 1000,
    lines: 100,
    qty: 1_000_000,
    prefix: 6,
    maxMoney: takaToMinor(1_00_00_000),
} as const;

const money = z
    .number()
    .int('invalid')
    .min(0, 'invalid')
    .max(PURCHASE_LIMITS.maxMoney, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');

export interface PurchaseLineMoney {
    /** How many were ordered. */
    quantity: number;
    /** How many have arrived. */
    received: number;
    unitCost: number;
}

export interface PurchaseMoney {
    status: PurchaseStatus;
    lines: PurchaseLineMoney[];
    delivery: number;
    other: number;
    discount: number;
    /** Paid to the supplier as part of this purchase. */
    paid: number;
}

export function receivedUnits(purchase: PurchaseMoney): number {
    return purchase.lines.reduce((sum, line) => sum + line.received, 0);
}

/**
 * Goods we owe for. A draft owes nothing. An order that has not arrived yet owes nothing:
 * the balance moves when stock is received.
 */
export function owedGoods(purchase: PurchaseMoney): number {
    if (purchase.status === 'draft') return 0;
    return purchase.lines.reduce((sum, line) => sum + line.received * line.unitCost, 0);
}

/** Delivery, other charges and the discount count once any goods from this purchase have arrived. */
export function owedCharges(purchase: PurchaseMoney): number {
    if (purchase.status === 'draft' || receivedUnits(purchase) === 0) return 0;
    return purchase.delivery + purchase.other - purchase.discount;
}

/** What this purchase adds to the supplier balance, before returns and later payments. */
export function purchaseOwed(purchase: PurchaseMoney): number {
    if (purchase.status === 'draft') return 0;
    return owedGoods(purchase) + owedCharges(purchase) - purchase.paid;
}

/** The bill as written. A line received above the order counts the higher quantity. */
export function billGoods(purchase: PurchaseMoney): number {
    return purchase.lines.reduce(
        (sum, line) => sum + Math.max(line.quantity, line.received) * line.unitCost,
        0,
    );
}

export function billTotal(purchase: PurchaseMoney): number {
    return billGoods(purchase) + purchase.delivery + purchase.other - purchase.discount;
}

/** Draft stays draft. Otherwise: nothing in → ordered, some lines short → partial, the rest received. */
export function statusAfterReceive(
    lines: Array<{ quantity: number; received: number }>,
    current: PurchaseStatus,
): PurchaseStatus {
    if (current === 'draft') return 'draft';
    if (lines.every(line => line.received === 0)) return 'ordered';
    return lines.every(line => line.received >= line.quantity) ? 'received' : 'partial';
}

export interface CostChange {
    stock: number;
    /** Null when the variation has no cost yet. */
    cost: number | null;
    qty: number;
    unitCost: number;
    method: CostMethod;
}

/**
 * Cost after goods arrive. Weighted average, unless the store uses latest cost, the shelf was
 * empty, or the old cost was unknown: those take this delivery's cost.
 */
export function costAfterReceive(input: CostChange): number {
    if (input.qty <= 0) return input.cost ?? input.unitCost;
    if (input.method === 'latest' || input.stock <= 0 || input.cost == null) return input.unitCost;
    return roundToWholeTaka(
        (input.cost * input.stock + input.unitCost * input.qty) / (input.stock + input.qty),
    );
}

export interface CostReturn extends CostChange {
    /** The variation's cost before this purchase first changed it. */
    priorCost: number | null;
    priorKnown: boolean;
    /** Received units of this line still in our hands after the return. */
    remaining: number;
}

/**
 * Cost after a purchase return. Empty stock falls back to this line's cost. A latest-cost line
 * that is fully returned puts the old cost back. An average removes these units' value.
 */
export function costAfterReturn(input: CostReturn): number {
    if (input.stock - input.qty <= 0) return input.unitCost;
    if (input.method === 'latest' && input.remaining === 0 && input.priorKnown) {
        return input.priorCost ?? input.unitCost;
    }
    if (input.cost == null) return input.unitCost;
    if (input.method === 'latest') return input.cost;
    const value = input.cost * input.stock - input.unitCost * input.qty;
    if (value <= 0) return input.unitCost;
    return roundToWholeTaka(value / (input.stock - input.qty));
}

export interface SupplierBalanceInput {
    purchases: PurchaseMoney[];
    returns: Array<{ quantity: number; unitCost: number }>;
    /** Payments recorded against the supplier, separate from a purchase's own paid amount. */
    payments: number;
}

/** Purchases still owed, minus returns, minus later payments. Can be negative when we paid ahead. */
export function supplierBalance(input: SupplierBalanceInput): number {
    const owed = input.purchases.reduce((sum, purchase) => sum + purchaseOwed(purchase), 0);
    const returned = input.returns.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
    return owed - returned - input.payments;
}

/** True when this receive goes past what was ordered and no note was written. */
export function overReceiveNeedsNote(
    lines: Array<{ quantity: number; received: number; add: number }>,
    note: string,
): boolean {
    const over = lines.some(line => line.add > 0 && line.received + line.add > line.quantity);
    return over && cleanText(note) === '';
}

export interface PurchaseSettings {
    /** Number prefix, without the hyphen. "PO" and 1001 → PO-1001. */
    purchasePrefix: string;
    returnPrefix: string;
    /** How a received purchase updates the variation's cost. */
    costMethod: CostMethod;
}

export function defaultPurchaseSettings(): PurchaseSettings {
    return { purchasePrefix: 'PO', returnPrefix: 'PR', costMethod: 'average' };
}

const prefix = z
    .string()
    .transform(value =>
        cleanText(value)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, PURCHASE_LIMITS.prefix),
    );

const settingsSchema = z.object({
    purchasePrefix: prefix,
    returnPrefix: prefix,
    costMethod: z.enum(COST_METHODS),
});

export type ParsePurchaseSettingsResult =
    | { ok: true; settings: PurchaseSettings }
    | { ok: false; errors: SettingsFieldError[] };

export function parsePurchaseSettings(input: unknown): ParsePurchaseSettingsResult {
    const result = settingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

export function formatPurchaseNumber(prefixValue: string, sequence: number): string {
    return formatOrderNumber(prefixValue, sequence);
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid');

/** A calendar day `YYYY-MM-DD`, rejected when it is not a real date. */
export function parseCalendarDay(input: string): string | null {
    const parsed = day.safeParse(input);
    if (!parsed.success) return null;
    const [year, month, date] = parsed.data.split('-').map(Number);
    const check = new Date(Date.UTC(year!, month! - 1, date));
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month! - 1 ||
        check.getUTCDate() !== date
    ) {
        return null;
    }
    return parsed.data;
}

export const purchaseLineSchema = z.object({
    id: z.string().trim().min(1).max(40).nullable(),
    variantId: z.string().trim().min(1).max(40),
    quantity: z.number().int('invalid').min(1, 'invalid').max(PURCHASE_LIMITS.qty, 'invalid'),
    unitCost: money,
});

export const purchaseDraftSchema = z.object({
    supplierId: z.string().trim().min(1).max(40),
    purchasedOn: z.string().refine(value => parseCalendarDay(value) !== null, 'invalid'),
    note: z.string().transform(value => cleanText(value, { multiline: true })).pipe(z.string().max(PURCHASE_LIMITS.note)),
    delivery: money,
    other: money,
    discount: money,
    paid: money,
    lines: z.array(purchaseLineSchema).min(1, 'required').max(PURCHASE_LIMITS.lines, 'invalid'),
    billAssetId: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .nullable()
        .optional()
        .transform(value => value ?? null),
});

export type PurchaseDraftInput = z.infer<typeof purchaseDraftSchema>;

export function parsePurchaseDraft(input: unknown):
    | { ok: true; value: PurchaseDraftInput }
    | { ok: false; errors: SettingsFieldError[] } {
    const result = purchaseDraftSchema.safeParse(input);
    return result.success
        ? { ok: true, value: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

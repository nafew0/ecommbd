import type { MoneyPart, OrderProfit } from './cost';
import { toSettingsFieldErrors, type SettingsFieldError } from './store-settings';
import { z } from 'zod';

/**
 * Accounts, expenses and the profit and loss report (phase 53).
 * Money is integer poisha. A date is a Dhaka calendar day, `YYYY-MM-DD`.
 */

export const ACCOUNT_KINDS = ['cash', 'bank', 'wallet', 'courier'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const TX_SOURCES = ['order', 'purchase', 'expense', 'transfer', 'manual'] as const;
export type TxSource = (typeof TX_SOURCES)[number];

/** The heads a new store starts with. Ads are entered by hand; nothing is imported from Meta. */
export const DEFAULT_EXPENSE_HEADS = [
    { code: 'rent', nameBn: 'ভাড়া', nameEn: 'Rent' },
    { code: 'salary', nameBn: 'বেতন', nameEn: 'Salary' },
    { code: 'ads', nameBn: 'বিজ্ঞাপন', nameEn: 'Ads' },
    { code: 'packaging', nameBn: 'প্যাকেজিং', nameEn: 'Packaging' },
    { code: 'delivery', nameBn: 'ডেলিভারি', nameEn: 'Delivery' },
    { code: 'utilities', nameBn: 'বিল', nameEn: 'Utilities' },
    { code: 'other', nameBn: 'অন্যান্য', nameEn: 'Other' },
] as const;

export interface AccountSettings {
    /** Settled cash-on-delivery payments (phase 37 reconciliation is not built; this is the settled payment). */
    codAccountId: string | null;
    /** Settled online gateway payouts. */
    gatewayAccountId: string | null;
    bkashAccountId: string | null;
    nagadAccountId: string | null;
    rocketAccountId: string | null;
}

export function defaultAccountSettings(): AccountSettings {
    return {
        codAccountId: null,
        gatewayAccountId: null,
        bkashAccountId: null,
        nagadAccountId: null,
        rocketAccountId: null,
    };
}

const accountId = z
    .string()
    .trim()
    .max(40, 'tooLong')
    .nullable()
    .optional()
    .transform(value => (value ? value : null));

const settingsSchema = z.object({
    codAccountId: accountId,
    gatewayAccountId: accountId,
    bkashAccountId: accountId,
    nagadAccountId: accountId,
    rocketAccountId: accountId,
});

export type ParseAccountSettingsResult =
    | { ok: true; settings: AccountSettings }
    | { ok: false; errors: SettingsFieldError[] };

export function parseAccountSettings(input: unknown): ParseAccountSettingsResult {
    const result = settingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/** Opening balance plus movements. The result may be negative: an expense is not blocked. */
export function accountBalance(opening: number, netMovements: number): number {
    return opening + netMovements;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

function parseDay(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = Date.UTC(year, month - 1, day);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return null;
    }
    return utc;
}

function formatDay(utc: number): string {
    const date = new Date(utc);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Inclusive Dhaka calendar days from `dateFrom` through `dateTo`.
 * Null when a day is not real, the end is before the start, or the range is longer than 366 days
 * (the same limit as the order dashboard).
 */
export function dhakaDayKeys(dateFrom: string, dateTo: string): string[] | null {
    const start = parseDay(dateFrom);
    const end = parseDay(dateTo);
    if (start == null || end == null || end < start) return null;
    const count = Math.round((end - start) / DAY_MS) + 1;
    if (count > MAX_RANGE_DAYS) return null;
    return Array.from({ length: count }, (_, index) => formatDay(start + index * DAY_MS));
}

/** The same number of days, ending the day before `dateFrom`. */
export function previousDhakaRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } | null {
    const days = dhakaDayKeys(dateFrom, dateTo);
    if (!days) return null;
    const start = parseDay(dateFrom)!;
    const prevEnd = start - DAY_MS;
    const prevStart = prevEnd - (days.length - 1) * DAY_MS;
    return { dateFrom: formatDay(prevStart), dateTo: formatDay(prevEnd) };
}

export interface PlMovement {
    orderCode: string;
    /**
     * Dhaka day the sale was recognized (first delivery). For an order that came back without
     * being delivered, the return day: sales and product cost are 0 and only the charges count.
     */
    saleDate: string;
    /** Dhaka day of a later return, if the order was returned after that sale. It reverses sales and product cost only. */
    returnDate: string | null;
    /** What the customer paid for the delivered goods. Null when any piece is unknown. */
    sales: number | null;
    productCost: number | null;
    /** Courier charge plus the COD charge we pay. */
    deliveryAndCod: number | null;
    gatewayFee: number | null;
}

/** The positive side of phase 51's profit, and the charges we pay. Unknown stays unknown. */
export function plMovement(
    profit: OrderProfit,
    meta: { orderCode: string; saleDate: string; returnDate: string | null },
): PlMovement {
    return {
        ...meta,
        sales: combine(profit.sellingPrice, profit.discount, profit.deliveryCharged, profit.codFeeCharged, (s, d, c, f) => s - d + c + f),
        productCost: partAmount(profit.productCost),
        deliveryAndCod: combine(profit.courierCharge, profit.codCharge, null, null, (courier, cod) => courier + cod),
        gatewayFee: partAmount(profit.gatewayFee),
    };
}

function partAmount(part: MoneyPart): number | null {
    return part.known && part.amount != null ? part.amount : null;
}

function combine(
    a: MoneyPart,
    b: MoneyPart,
    c: MoneyPart | null,
    d: MoneyPart | null,
    add: (a: number, b: number, c: number, d: number) => number,
): number | null {
    const parts = [a, b, c, d].filter((part): part is MoneyPart => part != null);
    if (parts.some(part => !part.known || part.amount == null)) return null;
    return add(a.amount!, b.amount!, c == null ? 0 : c.amount!, d == null ? 0 : d.amount!);
}

export interface PlExpense {
    date: string;
    headCode: string;
    amount: number;
}

export interface PlPiece {
    known: boolean;
    amount: number | null;
}

export interface ProfitAndLossReport {
    sales: PlPiece;
    productCost: PlPiece;
    deliveryAndCod: PlPiece;
    gatewayFees: PlPiece;
    expensesByHead: Array<{ headCode: string; amount: number }>;
    expenseTotal: number;
    profit: PlPiece;
    days: Array<{ date: string; sales: number | null; profit: number | null }>;
    /** A return whose sale sits outside this range. The sale itself is left in its own month. */
    notes: Array<{ orderCode: string; saleDate: string; returnDate: string }>;
}

const PIECES = ['sales', 'productCost', 'deliveryAndCod', 'gatewayFee'] as const;
type Piece = (typeof PIECES)[number];

/**
 * Profit for a Dhaka range.
 * Sales are recognized on the delivery day and reversed on a later return day.
 * A transfer is not a movement here, so it cannot change the profit.
 * Any unknown order piece makes that report piece unknown (never ৳0).
 */
export function profitAndLoss(input: {
    days: string[];
    movements: PlMovement[];
    expenses: PlExpense[];
}): ProfitAndLossReport {
    const totals = fresh();
    const byDay = new Map(input.days.map(date => [date, { parts: fresh(), expense: 0 }]));
    const notes: ProfitAndLossReport['notes'] = [];
    for (const movement of input.movements) {
        if (byDay.has(movement.saleDate)) apply(totals, movement, 1);
        if (movement.returnDate && byDay.has(movement.returnDate)) {
            apply(totals, movement, -1);
            if (!byDay.has(movement.saleDate)) {
                notes.push({
                    orderCode: movement.orderCode,
                    saleDate: movement.saleDate,
                    returnDate: movement.returnDate,
                });
            }
        }
        const sale = byDay.get(movement.saleDate);
        if (sale) apply(sale.parts, movement, 1);
        if (movement.returnDate) {
            const back = byDay.get(movement.returnDate);
            if (back) apply(back.parts, movement, -1);
        }
    }
    const heads = new Map<string, number>();
    let expenseTotal = 0;
    for (const expense of input.expenses) {
        const day = byDay.get(expense.date);
        if (!day) continue;
        day.expense += expense.amount;
        expenseTotal += expense.amount;
        heads.set(expense.headCode, (heads.get(expense.headCode) ?? 0) + expense.amount);
    }
    const order = DEFAULT_EXPENSE_HEADS.map(head => head.code as string);
    const expensesByHead = [...heads.entries()]
        .sort((a, b) => {
            const rank = headRank(a[0], order) - headRank(b[0], order);
            return rank !== 0 ? rank : a[0].localeCompare(b[0]);
        })
        .map(([headCode, amount]) => ({ headCode, amount }));
    return {
        sales: piece(totals.sales),
        productCost: piece(totals.productCost),
        deliveryAndCod: piece(totals.deliveryAndCod),
        gatewayFees: piece(totals.gatewayFee),
        expensesByHead,
        expenseTotal,
        profit: profitPiece(totals, expenseTotal),
        days: input.days.map(date => {
            const day = byDay.get(date)!;
            return {
                date,
                sales: piece(day.parts.sales).amount,
                profit: profitPiece(day.parts, day.expense).amount,
            };
        }),
        notes,
    };
}

function headRank(code: string, order: string[]): number {
    const index = order.indexOf(code);
    return index === -1 ? order.length : index;
}

interface Acc {
    known: boolean;
    amount: number;
}

function fresh(): Record<Piece, Acc> {
    return {
        sales: { known: true, amount: 0 },
        productCost: { known: true, amount: 0 },
        deliveryAndCod: { known: true, amount: 0 },
        gatewayFee: { known: true, amount: 0 },
    };
}

/**
 * A return gives back the sale and puts the goods back on the shelf, so it reverses sales and
 * product cost. The courier, COD and gateway charges were still paid: they stay.
 */
const REVERSED_ON_RETURN: readonly Piece[] = ['sales', 'productCost'];

function apply(target: Record<Piece, Acc>, movement: PlMovement, sign: 1 | -1) {
    const values: Record<Piece, number | null> = {
        sales: movement.sales,
        productCost: movement.productCost,
        deliveryAndCod: movement.deliveryAndCod,
        gatewayFee: movement.gatewayFee,
    };
    for (const key of sign === 1 ? PIECES : REVERSED_ON_RETURN) {
        const value = values[key];
        if (value == null) target[key].known = false;
        else target[key].amount += sign * value;
    }
}

function piece(acc: Acc): PlPiece {
    return acc.known ? { known: true, amount: acc.amount } : { known: false, amount: null };
}

function profitPiece(parts: Record<Piece, Acc>, expense: number): PlPiece {
    if (PIECES.some(key => !parts[key].known)) return { known: false, amount: null };
    return {
        known: true,
        amount:
            parts.sales.amount -
            parts.productCost.amount -
            parts.deliveryAndCod.amount -
            parts.gatewayFee.amount -
            expense,
    };
}

/** UTF-8 CSV with a BOM. Cells that a spreadsheet would treat as a formula are prefixed. */
export function csvDocument(headers: string[], rows: string[][]): string {
    const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','));
    return `\uFEFF${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    const formula = /^[=+\-@\t\r]/.test(value);
    const text = formula ? `'${value}` : value;
    if (formula || /[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

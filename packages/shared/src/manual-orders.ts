/**
 * Orders staff enter for shoppers who ordered by phone, Messenger or WhatsApp, and edits to orders
 * before they ship (roadmap phase 05). Shared by the server and the merchant admin.
 */

export const ORDER_SOURCES = [
    'messenger',
    'facebookComment',
    'phone',
    'whatsapp',
    'walkIn',
    'other',
] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** How a manual order is paid: on delivery, already paid in full, or an advance with the rest on delivery. */
export const MANUAL_PAYMENT_TYPES = ['cod', 'paid', 'advance'] as const;
export type ManualPaymentType = (typeof MANUAL_PAYMENT_TYPES)[number];

/** How the money came, when it was paid already. */
export const MANUAL_PAYMENT_METHODS = ['bkash', 'nagad', 'rocket', 'cash', 'bank'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

/** Staff with ApplyManualDiscount (but not UnlimitedDiscount) may discount up to this share of the subtotal. */
export const STAFF_DISCOUNT_CAP_PERCENT = 10;

export const MANUAL_ORDER_ERROR_CODES = [
    'INVALID_PHONE',
    'NAME_REQUIRED',
    'NO_ITEMS',
    'INVALID_QUANTITY',
    'UNKNOWN_PRODUCT',
    'INSUFFICIENT_STOCK',
    'INVALID_PRICE',
    'PRICE_OVERRIDE_NOT_ALLOWED',
    'DISCOUNT_NOT_ALLOWED',
    'DISCOUNT_TOO_LARGE',
    'INVALID_ADDRESS',
    'NO_DELIVERY',
    'INVALID_SOURCE',
    'INVALID_PAYMENT',
    'INVALID_TRANSACTION_ID',
    'DUPLICATE_TRANSACTION_ID',
    'PAYMENT_REFUSED',
    'ORDER_NOT_FOUND',
    'NOT_EDITABLE',
    'ALREADY_CHANGED',
    'COURIER_BOOKED',
    'NOTHING_CHANGED',
] as const;
export type ManualOrderErrorCode = (typeof MANUAL_ORDER_ERROR_CODES)[number];

/** Statuses in which an order can still be edited (before it's handed to delivery). */
export const EDITABLE_STATUSES = ['new', 'confirmed', 'packed'] as const;

/** The largest discount a staff member may give on this subtotal; `Infinity` with UnlimitedDiscount. */
export function maxManualDiscount(subTotal: number, unlimited: boolean): number {
    if (unlimited) return Number.POSITIVE_INFINITY;
    // Whole taka, rounded down so the cap is never exceeded.
    return Math.floor((subTotal * STAFF_DISCOUNT_CAP_PERCENT) / 100 / 100) * 100;
}

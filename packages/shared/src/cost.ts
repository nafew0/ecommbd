import { z } from 'zod';
import { isWholeTaka, percentOfWholeTaka, roundToWholeTaka, takaToMinor } from './money';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';

/**
 * Cost and profit (roadmap phase 51). Amounts are poisha, and prices are whole taka.
 * A missing cost is null. It is never stored or shown as ৳0.
 */

export const COST_LIMITS = {
    maxCharge: takaToMinor(10_000),
    maxPercent: 20,
} as const;

/** Private WooCommerce meta keys that cost plugins use. The helper exports only these. */
export const WOO_COST_META_KEYS = [
    '_wc_cog_cost',
    '_alg_wc_cog_cost',
    '_yith_cog_cost',
    '_purchase_price',
] as const;

const wholeTaka = z
    .number()
    .int('invalid')
    .min(0, 'invalid')
    .max(COST_LIMITS.maxCharge, 'invalid')
    .refine(value => isWholeTaka(value), 'invalid');

const percent = z.number().int('invalid').min(0, 'invalid').max(COST_LIMITS.maxPercent, 'invalid');

export const costSettingsSchema = z.object({
    /** What we pay the courier when the booking has no charge. Null means we don't know yet. */
    courierFlat: wholeTaka.nullable(),
    /** What we pay for cash on delivery. Not the fee charged to the customer. */
    codCharge: z.object({
        type: z.enum(['flat', 'percent']),
        flat: wholeTaka.nullable(),
        percent: percent.nullable(),
    }),
    /** Percent of money settled through SSLCommerz or bKash online. Null means we don't know yet. */
    gatewayFeePercent: percent.nullable(),
});

export type CostSettings = z.output<typeof costSettingsSchema>;

export function defaultCostSettings(): CostSettings {
    return {
        courierFlat: null,
        codCharge: { type: 'flat', flat: null, percent: null },
        gatewayFeePercent: null,
    };
}

export type ParseCostSettingsResult =
    { ok: true; settings: CostSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseCostSettings(input: unknown): ParseCostSettingsResult {
    const result = costSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

/**
 * A WooCommerce cost string ("450", "450.00") as poisha. Empty, fractional taka and nonsense
 * are null: the product is imported, and its cost stays missing.
 */
export function wooUnitCost(value: string): number | null {
    const raw = value.trim().replace(/,/g, '');
    if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
    const [whole, fraction = ''] = raw.split('.');
    const poisha = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(poisha) || poisha > takaToMinor(1_00_00_000) || !isWholeTaka(poisha)) return null;
    return poisha;
}

/** (price − cost) / price, half-up to the nearest percent. Null when the cost or the price is missing. */
export function marginPercent(price: number, cost: number | null): number | null {
    if (cost == null || price <= 0) return null;
    const percentValue = ((price - cost) * 100) / price;
    const cleaned = Math.round(percentValue * 1e6) / 1e6;
    return Math.sign(cleaned) * Math.round(Math.abs(cleaned));
}

export type ProfitSource =
    | 'order'
    | 'costSnapshot'
    | 'courier'
    | 'storeSetting'
    | 'notBooked'
    | 'prepaid'
    | 'noGateway'
    | 'notCollected';

export interface MoneyPart {
    /** Null when this part is unknown. A known zero is 0. */
    amount: number | null;
    known: boolean;
    source: ProfitSource;
    /** Courier code or the name staff typed, when the source is the courier. */
    detail: string | null;
}

export type ProfitCountState = 'open' | 'delivered' | 'partiallyDelivered' | 'returned' | 'cancelled';

export function profitCountState(status: string | null | undefined): ProfitCountState {
    if (status === 'cancelled') return 'cancelled';
    if (status === 'returned') return 'returned';
    if (status === 'partiallyDelivered') return 'partiallyDelivered';
    if (status === 'delivered') return 'delivered';
    return 'open';
}

export interface ProfitLineInput {
    quantity: number;
    returnedQuantity: number;
    linePriceWithTax: number;
    proratedLinePriceWithTax: number;
    /** Null when the cost was missing at the snapshot. */
    unitCost: number | null;
}

export interface ProfitInput {
    state: ProfitCountState;
    lines: ProfitLineInput[];
    shippingWithTax: number;
    /** The COD fee surcharge charged to the customer. */
    customerCodFee: number;
    /** The courier's own charge, when the booking has one. */
    courierDeliveryFee: number | null;
    booked: boolean;
    courierName: string | null;
    paymentType: 'cod' | 'advance' | 'prepaid';
    codDue: number;
    /** Settled SSLCommerz and online bKash payments, refunds taken off. */
    onlinePaid: number;
    settings: CostSettings;
}

export interface ProfitLineResult {
    deliveredQuantity: number | null;
    unitCost: number | null;
    belowCost: boolean;
}

export interface OrderProfit {
    sellingPrice: MoneyPart;
    discount: MoneyPart;
    deliveryCharged: MoneyPart;
    codFeeCharged: MoneyPart;
    productCost: MoneyPart;
    courierCharge: MoneyPart;
    codCharge: MoneyPart;
    gatewayFee: MoneyPart;
    profit: MoneyPart;
    belowCost: boolean;
    lines: ProfitLineResult[];
}

const known = (amount: number, source: ProfitSource, detail: string | null = null): MoneyPart => ({
    amount: roundToWholeTaka(amount),
    known: true,
    source,
    detail,
});

const unknown = (source: ProfitSource, detail: string | null = null): MoneyPart => ({
    amount: null,
    known: false,
    source,
    detail,
});

/** The line's money for the units that were kept, rounded to whole taka. */
function scale(amount: number, delivered: number, quantity: number): number {
    if (quantity <= 0 || delivered <= 0) return 0;
    if (delivered >= quantity) return amount;
    return roundToWholeTaka((amount * delivered) / quantity);
}

/**
 * How many of the line were kept.
 * A partly delivered order with no returned quantity on any line is unknown: we don't invent a split.
 * A returned order with no returned quantity came back whole (phase 37 has not filled the field yet).
 */
export function deliveredQuantity(
    state: ProfitCountState,
    line: { quantity: number; returnedQuantity: number },
    anyReturnRecorded: boolean,
): number | null {
    if (state === 'cancelled') return 0;
    if (state === 'returned') {
        if (line.returnedQuantity > 0) return Math.max(0, line.quantity - line.returnedQuantity);
        return 0;
    }
    if (state === 'partiallyDelivered' && !anyReturnRecorded) return null;
    return Math.max(0, line.quantity - Math.max(0, line.returnedQuantity));
}

function courierCharge(input: ProfitInput): MoneyPart {
    if (input.courierDeliveryFee != null) return known(input.courierDeliveryFee, 'courier', input.courierName);
    if (input.state === 'cancelled' && !input.booked) return known(0, 'notBooked');
    if (input.settings.courierFlat != null) return known(input.settings.courierFlat, 'storeSetting');
    return unknown(input.booked ? 'courier' : 'storeSetting', input.booked ? input.courierName : null);
}

function codCharge(input: ProfitInput, linesUnknown: boolean, anyDelivered: boolean): MoneyPart {
    if (input.state === 'cancelled' || (!linesUnknown && !anyDelivered)) return known(0, 'notCollected');
    if (input.paymentType === 'prepaid' || input.codDue <= 0) return known(0, 'prepaid');
    const setting = input.settings.codCharge;
    if (setting.type === 'percent') {
        return setting.percent == null
            ? unknown('storeSetting')
            : known(percentOfWholeTaka(input.codDue, setting.percent), 'storeSetting');
    }
    return setting.flat == null ? unknown('storeSetting') : known(setting.flat, 'storeSetting');
}

function gatewayFee(input: ProfitInput): MoneyPart {
    if (input.onlinePaid <= 0) return known(0, 'noGateway');
    if (input.settings.gatewayFeePercent == null) return unknown('storeSetting');
    return known(percentOfWholeTaka(input.onlinePaid, input.settings.gatewayFeePercent), 'storeSetting');
}

/**
 * Profit = selling price − discount + delivery charged to the customer + COD fee charged to the
 * customer − product cost − courier charge − COD charge we pay − gateway fee.
 * Any unknown cost makes the profit unknown. A known zero stays zero.
 */
export function orderProfit(input: ProfitInput): OrderProfit {
    const anyReturnRecorded = input.lines.some(line => line.returnedQuantity > 0);
    const delivered = input.lines.map(line => deliveredQuantity(input.state, line, anyReturnRecorded));
    const linesUnknown = delivered.some(quantity => quantity == null);
    let selling = 0;
    let net = 0;
    let product = 0;
    let productKnown = !linesUnknown;
    let belowCost = false;
    const lines: ProfitLineResult[] = input.lines.map((line, index) => {
        const quantity = delivered[index] ?? null;
        const isBelow =
            quantity != null &&
            quantity > 0 &&
            line.unitCost != null &&
            line.quantity > 0 &&
            line.proratedLinePriceWithTax < line.unitCost * line.quantity;
        if (isBelow) belowCost = true;
        if (quantity == null) {
            return { deliveredQuantity: null, unitCost: line.unitCost, belowCost: false };
        }
        selling += scale(line.linePriceWithTax, quantity, line.quantity);
        net += scale(line.proratedLinePriceWithTax, quantity, line.quantity);
        if (quantity > 0) {
            if (line.unitCost == null) productKnown = false;
            else product += line.unitCost * quantity;
        }
        return { deliveredQuantity: quantity, unitCost: line.unitCost, belowCost: isBelow };
    });
    const anyDelivered = delivered.some(quantity => (quantity ?? 0) > 0);
    const sellingPrice = linesUnknown ? unknown('order') : known(selling, 'order');
    const discount = linesUnknown ? unknown('order') : known(selling - net, 'order');
    const deliveryCharged = linesUnknown
        ? unknown('order')
        : known(anyDelivered ? input.shippingWithTax : 0, 'order');
    const codFeeCharged = linesUnknown
        ? unknown('order')
        : known(anyDelivered ? input.customerCodFee : 0, 'order');
    const productCost = productKnown ? known(product, 'costSnapshot') : unknown('costSnapshot');
    const courier = courierCharge(input);
    const cod = codCharge(input, linesUnknown, anyDelivered);
    const gateway = gatewayFee(input);
    const parts = [sellingPrice, discount, deliveryCharged, codFeeCharged, productCost, courier, cod, gateway];
    const profit = parts.every(part => part.known)
        ? known(
              sellingPrice.amount! -
                  discount.amount! +
                  deliveryCharged.amount! +
                  codFeeCharged.amount! -
                  productCost.amount! -
                  courier.amount! -
                  cod.amount! -
                  gateway.amount!,
              'order',
          )
        : unknown('order');
    return {
        sellingPrice,
        discount,
        deliveryCharged,
        codFeeCharged,
        productCost,
        courierCharge: courier,
        codCharge: cod,
        gatewayFee: gateway,
        profit,
        belowCost,
        lines,
    };
}

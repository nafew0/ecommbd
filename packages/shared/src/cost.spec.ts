import { describe, expect, it } from 'vitest';
import {
    defaultCostSettings,
    marginPercent,
    orderProfit,
    parseCostSettings,
    profitCountState,
    type ProfitInput,
    wooUnitCost,
} from './cost';
import { takaToMinor } from './money';

const tk = takaToMinor;

const base = (patch: Partial<ProfitInput> = {}): ProfitInput => ({
    state: 'open',
    lines: [
        {
            quantity: 1,
            returnedQuantity: 0,
            linePriceWithTax: tk(1000),
            proratedLinePriceWithTax: tk(900),
            unitCost: tk(400),
        },
    ],
    shippingWithTax: tk(60),
    customerCodFee: tk(10),
    courierDeliveryFee: tk(80),
    booked: true,
    courierName: 'steadfast',
    paymentType: 'cod',
    codDue: tk(970),
    onlinePaid: 0,
    settings: {
        ...defaultCostSettings(),
        codCharge: { type: 'flat', flat: tk(15), percent: null },
    },
    ...patch,
});

describe('orderProfit', () => {
    it('subtracts the snapshot cost, the courier charge and the COD charge we pay', () => {
        const profit = orderProfit(base());
        expect(profit.sellingPrice.amount).toBe(tk(1000));
        expect(profit.discount.amount).toBe(tk(100));
        expect(profit.deliveryCharged.amount).toBe(tk(60));
        expect(profit.codFeeCharged.amount).toBe(tk(10));
        expect(profit.productCost).toMatchObject({ amount: tk(400), known: true, source: 'costSnapshot' });
        expect(profit.courierCharge).toMatchObject({
            amount: tk(80),
            known: true,
            source: 'courier',
            detail: 'steadfast',
        });
        expect(profit.codCharge).toMatchObject({ amount: tk(15), known: true, source: 'storeSetting' });
        expect(profit.gatewayFee).toMatchObject({ amount: 0, known: true, source: 'noGateway' });
        // 1000 − 100 + 60 + 10 − 400 − 80 − 15 = 475
        expect(profit.profit).toMatchObject({ amount: tk(475), known: true });
        expect(profit.belowCost).toBe(false);
    });

    it('shows unknown, never zero, when the product cost was missing', () => {
        const profit = orderProfit(
            base({
                lines: [{ ...base().lines[0]!, unitCost: null }],
            }),
        );
        expect(profit.productCost).toEqual({
            amount: null,
            known: false,
            source: 'costSnapshot',
            detail: null,
        });
        expect(profit.profit).toEqual({ amount: null, known: false, source: 'order', detail: null });
        expect(profit.sellingPrice.known).toBe(true);
    });

    it('keeps a cost of zero as zero', () => {
        const profit = orderProfit(base({ lines: [{ ...base().lines[0]!, unitCost: 0 }] }));
        expect(profit.productCost).toMatchObject({ amount: 0, known: true });
        expect(profit.profit.known).toBe(true);
    });

    it('warns when a line is priced below its cost and still returns a profit', () => {
        const profit = orderProfit(
            base({ lines: [{ ...base().lines[0]!, proratedLinePriceWithTax: tk(300), unitCost: tk(400) }] }),
        );
        expect(profit.belowCost).toBe(true);
        expect(profit.lines[0]?.belowCost).toBe(true);
        expect(profit.profit.known).toBe(true);
    });

    it('counts only the units that were kept on a partial delivery', () => {
        const line = {
            quantity: 2,
            returnedQuantity: 1,
            linePriceWithTax: tk(1000),
            proratedLinePriceWithTax: tk(1000),
            unitCost: tk(400),
        };
        const profit = orderProfit(base({ state: 'partiallyDelivered', lines: [line], customerCodFee: 0 }));
        expect(profit.lines[0]?.deliveredQuantity).toBe(1);
        expect(profit.sellingPrice.amount).toBe(tk(500));
        expect(profit.productCost.amount).toBe(tk(400));
    });

    it('does not guess the split when a partial delivery never recorded what came back', () => {
        const profit = orderProfit(
            base({
                state: 'partiallyDelivered',
                lines: [{ ...base().lines[0]!, quantity: 2, returnedQuantity: 0 }],
            }),
        );
        expect(profit.lines[0]?.deliveredQuantity).toBeNull();
        expect(profit.productCost.known).toBe(false);
        expect(profit.profit.amount).toBeNull();
    });

    it('counts a returned order with no recorded quantity as fully returned', () => {
        const profit = orderProfit(base({ state: 'returned', courierDeliveryFee: null, booked: false }));
        expect(profit.lines[0]?.deliveredQuantity).toBe(0);
        expect(profit.sellingPrice.amount).toBe(0);
        expect(profit.productCost).toMatchObject({ amount: 0, known: true });
        expect(profit.deliveryCharged.amount).toBe(0);
        expect(profit.codCharge).toMatchObject({ amount: 0, source: 'notCollected' });
        expect(profit.courierCharge).toMatchObject({ amount: null, known: false, source: 'storeSetting' });
        expect(profit.profit.amount).toBeNull();
    });

    it('does not charge a courier flat amount on a cancelled order that was never booked', () => {
        const profit = orderProfit(
            base({
                state: 'cancelled',
                courierDeliveryFee: null,
                booked: false,
                settings: { ...defaultCostSettings(), courierFlat: tk(60) },
            }),
        );
        expect(profit.courierCharge).toMatchObject({ amount: 0, known: true, source: 'notBooked' });
        expect(profit.productCost.amount).toBe(0);
        expect(profit.profit.amount).toBe(0);
    });

    it('uses the store flat amount until the courier reports a charge', () => {
        const profit = orderProfit(
            base({
                courierDeliveryFee: null,
                booked: false,
                settings: {
                    ...defaultCostSettings(),
                    courierFlat: tk(60),
                    codCharge: { type: 'flat', flat: 0, percent: null },
                },
            }),
        );
        expect(profit.courierCharge).toMatchObject({ amount: tk(60), source: 'storeSetting' });
    });

    it('prefers the courier figure over the flat amount', () => {
        const profit = orderProfit(
            base({
                settings: {
                    ...defaultCostSettings(),
                    courierFlat: tk(60),
                    codCharge: { type: 'flat', flat: 0, percent: null },
                },
            }),
        );
        expect(profit.courierCharge.amount).toBe(tk(80));
    });

    it('leaves the courier charge unknown when nobody has said what it is', () => {
        const profit = orderProfit(
            base({ courierDeliveryFee: null, booked: false, settings: defaultCostSettings() }),
        );
        expect(profit.courierCharge).toMatchObject({ amount: null, known: false, source: 'storeSetting' });
        expect(profit.profit.known).toBe(false);
    });

    it('rounds a percent COD charge half-up to whole taka, and skips it when the order is prepaid', () => {
        const percent = orderProfit(
            base({
                settings: {
                    ...defaultCostSettings(),
                    codCharge: { type: 'percent', flat: null, percent: 1 },
                },
                codDue: tk(1350),
            }),
        );
        expect(percent.codCharge.amount).toBe(tk(14));
        const prepaid = orderProfit(base({ paymentType: 'prepaid', codDue: 0 }));
        expect(prepaid.codCharge).toMatchObject({ amount: 0, source: 'prepaid' });
    });

    it('charges a gateway percent only on settled online payments', () => {
        const profit = orderProfit(
            base({
                onlinePaid: tk(1000),
                settings: {
                    ...defaultCostSettings(),
                    gatewayFeePercent: 2,
                    codCharge: { type: 'flat', flat: 0, percent: null },
                },
            }),
        );
        expect(profit.gatewayFee).toMatchObject({ amount: tk(20), source: 'storeSetting' });
        const missing = orderProfit(base({ onlinePaid: tk(1000) }));
        expect(missing.gatewayFee.known).toBe(false);
        expect(missing.profit.amount).toBeNull();
    });
});

describe('marginPercent', () => {
    it('rounds half-up and stays unknown without a cost', () => {
        expect(marginPercent(tk(1000), tk(400))).toBe(60);
        expect(marginPercent(tk(300), tk(100))).toBe(67);
        expect(marginPercent(tk(1000), null)).toBeNull();
        expect(marginPercent(0, tk(10))).toBeNull();
        expect(marginPercent(tk(100), tk(150))).toBe(-50);
    });
});

describe('wooUnitCost', () => {
    it('reads whole taka and refuses the rest', () => {
        expect(wooUnitCost('450')).toBe(tk(450));
        expect(wooUnitCost('1,250.00')).toBe(tk(1250));
        expect(wooUnitCost('0')).toBe(0);
        expect(wooUnitCost('')).toBeNull();
        expect(wooUnitCost('12.50')).toBeNull();
        expect(wooUnitCost('free')).toBeNull();
        expect(wooUnitCost('100000001')).toBeNull();
        expect(wooUnitCost('9999999999999999')).toBeNull();
    });
});

describe('parseCostSettings', () => {
    it('accepts a complete setting and refuses a fractional taka amount', () => {
        const ok = parseCostSettings(defaultCostSettings());
        expect(ok.ok && ok.settings.courierFlat).toBeNull();
        const result = parseCostSettings({ ...defaultCostSettings(), courierFlat: 150 });
        expect(result.ok).toBe(false);
    });
});

describe('profitCountState', () => {
    it('maps the order status onto what profit counts', () => {
        expect(profitCountState('cancelled')).toBe('cancelled');
        expect(profitCountState('returned')).toBe('returned');
        expect(profitCountState('partiallyDelivered')).toBe('partiallyDelivered');
        expect(profitCountState('delivered')).toBe('delivered');
        expect(profitCountState('new')).toBe('open');
        expect(profitCountState(null)).toBe('open');
    });
});

describe('orderProfit remaining cases', () => {
    it('keeps part of a return when the quantity was recorded, and names a booked courier with no fee', () => {
        const kept = orderProfit(
            base({
                state: 'returned',
                lines: [
                    { ...base().lines[0]!, quantity: 2, returnedQuantity: 1, linePriceWithTax: tk(1000) },
                ],
            }),
        );
        expect(kept.lines[0]?.deliveredQuantity).toBe(1);
        const unnamed = orderProfit(base({ courierDeliveryFee: null, courierName: 'Pathao express' }));
        expect(unnamed.courierCharge).toMatchObject({
            amount: null,
            known: false,
            source: 'courier',
            detail: 'Pathao express',
        });
    });

    it('takes a percent COD charge only on the cash collected for delivered items', () => {
        const profit = orderProfit(
            base({
                state: 'partiallyDelivered',
                lines: [
                    {
                        ...base().lines[0]!,
                        quantity: 2,
                        returnedQuantity: 1,
                        linePriceWithTax: tk(2000),
                        proratedLinePriceWithTax: tk(1800),
                    },
                ],
                codDue: tk(1870),
                settings: {
                    ...defaultCostSettings(),
                    codCharge: { type: 'percent', flat: null, percent: 1 },
                },
            }),
        );
        // 1870 due − 900 for the item that came back = 970 collected; 1% = 9.7 → 10
        expect(profit.codCharge).toMatchObject({ amount: tk(10), known: true, source: 'storeSetting' });
    });

    it('leaves a percent COD charge unknown until the percent is set', () => {
        const profit = orderProfit(
            base({
                settings: {
                    ...defaultCostSettings(),
                    codCharge: { type: 'percent', flat: null, percent: null },
                },
            }),
        );
        expect(profit.codCharge).toMatchObject({ amount: null, known: false, source: 'storeSetting' });
    });

    it('counts none of a line when more came back than were ordered', () => {
        const profit = orderProfit(
            base({
                state: 'delivered',
                lines: [{ ...base().lines[0]!, quantity: 1, returnedQuantity: 3 }],
            }),
        );
        expect(profit.lines[0]?.deliveredQuantity).toBe(0);
        expect(profit.productCost.amount).toBe(0);
        const empty = orderProfit(base({ lines: [{ ...base().lines[0]!, quantity: 0 }] }));
        expect(empty.sellingPrice.amount).toBe(0);
    });
});

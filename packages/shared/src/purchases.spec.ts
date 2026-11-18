import { describe, expect, it } from 'vitest';
import {
    billTotal,
    costAfterReceive,
    costAfterReturn,
    defaultPurchaseSettings,
    formatPurchaseNumber,
    overReceiveNeedsNote,
    owedCharges,
    owedGoods,
    parseCalendarDay,
    parsePurchaseDraft,
    parsePurchaseSettings,
    purchaseOwed,
    statusAfterReceive,
    supplierBalance,
} from './purchases';

const line = (quantity: number, received: number, unitCost: number) => ({ quantity, received, unitCost });

describe('purchase money', () => {
    const bill = {
        status: 'ordered' as const,
        lines: [line(10, 0, 10000)],
        delivery: 5000,
        other: 0,
        discount: 0,
        paid: 20000,
    };

    it('owes nothing until goods arrive, then counts what arrived plus the bill’s charges', () => {
        expect(purchaseOwed(bill)).toBe(-20000);
        expect(owedCharges(bill)).toBe(0);
        const arrived = { ...bill, status: 'partial' as const, lines: [line(10, 4, 10000)] };
        expect(purchaseOwed(arrived)).toBe(40000 + 5000 - 20000);
        expect(purchaseOwed({ ...bill, status: 'draft' })).toBe(0);
        expect(owedGoods({ ...bill, status: 'draft' })).toBe(0);
        expect(owedCharges({ ...bill, status: 'draft' })).toBe(0);
    });

    it('bills the higher of ordered and received, and a full return brings the balance back', () => {
        const received = { ...bill, status: 'received' as const, lines: [line(10, 12, 10000)] };
        expect(billTotal(received)).toBe(12 * 10000 + 5000);
        expect(
            supplierBalance({
                purchases: [received],
                returns: [{ quantity: 2, unitCost: 10000 }],
                payments: 15000,
            }),
        ).toBe(12 * 10000 + 5000 - 20000 - 20000 - 15000);
    });

    it('moves from ordered to partial to received', () => {
        expect(statusAfterReceive([line(2, 0, 1)], 'draft')).toBe('draft');
        expect(statusAfterReceive([line(2, 0, 1)], 'ordered')).toBe('ordered');
        expect(statusAfterReceive([line(2, 1, 1)], 'ordered')).toBe('partial');
        expect(statusAfterReceive([line(2, 3, 1)], 'partial')).toBe('received');
    });
});

describe('cost from a purchase', () => {
    it('uses the latest cost when the shelf is empty, the old cost is unknown, or the store says so', () => {
        expect(costAfterReceive({ stock: 0, cost: 8000, qty: 4, unitCost: 25000, method: 'average' })).toBe(25000);
        expect(costAfterReceive({ stock: 4, cost: null, qty: 4, unitCost: 25000, method: 'average' })).toBe(25000);
        expect(costAfterReceive({ stock: 4, cost: 25000, qty: 1, unitCost: 90000, method: 'latest' })).toBe(90000);
        expect(costAfterReceive({ stock: 4, cost: 25000, qty: 0, unitCost: 90000, method: 'average' })).toBe(25000);
        expect(costAfterReceive({ stock: 4, cost: null, qty: 0, unitCost: 90000, method: 'average' })).toBe(90000);
    });

    it('averages by the units on hand, and a return takes those units back out', () => {
        expect(costAfterReceive({ stock: 4, cost: 25000, qty: 4, unitCost: 35000, method: 'average' })).toBe(30000);
        expect(
            costAfterReturn({
                stock: 8,
                cost: 30000,
                qty: 4,
                unitCost: 35000,
                method: 'average',
                priorCost: 25000,
                priorKnown: true,
                remaining: 0,
            }),
        ).toBe(25000);
    });

    it('puts the previous cost back when a latest-cost line is fully returned, and falls back at zero stock', () => {
        expect(
            costAfterReturn({
                stock: 5,
                cost: 90000,
                qty: 1,
                unitCost: 90000,
                method: 'latest',
                priorCost: 25000,
                priorKnown: true,
                remaining: 0,
            }),
        ).toBe(25000);
        expect(
            costAfterReturn({
                stock: 5,
                cost: 90000,
                qty: 1,
                unitCost: 90000,
                method: 'latest',
                priorCost: null,
                priorKnown: true,
                remaining: 0,
            }),
        ).toBe(90000);
        expect(
            costAfterReturn({
                stock: 5,
                cost: 90000,
                qty: 1,
                unitCost: 90000,
                method: 'latest',
                priorCost: 25000,
                priorKnown: false,
                remaining: 1,
            }),
        ).toBe(90000);
        expect(
            costAfterReturn({
                stock: 1,
                cost: 90000,
                qty: 1,
                unitCost: 40000,
                method: 'average',
                priorCost: null,
                priorKnown: false,
                remaining: 0,
            }),
        ).toBe(40000);
        expect(
            costAfterReturn({
                stock: 4,
                cost: null,
                qty: 1,
                unitCost: 40000,
                method: 'average',
                priorCost: null,
                priorKnown: false,
                remaining: 1,
            }),
        ).toBe(40000);
        expect(
            costAfterReturn({
                stock: 2,
                cost: 1000,
                qty: 1,
                unitCost: 5000,
                method: 'average',
                priorCost: null,
                priorKnown: false,
                remaining: 1,
            }),
        ).toBe(5000);
    });
});

describe('purchase settings and drafts', () => {
    it('defaults to an average cost and PO / PR numbers', () => {
        expect(defaultPurchaseSettings()).toEqual({
            purchasePrefix: 'PO',
            returnPrefix: 'PR',
            costMethod: 'average',
        });
        expect(formatPurchaseNumber('PO', 1001)).toBe('PO-1001');
        expect(formatPurchaseNumber('', 1001)).toBe('1001');
    });

    it('accepts a real day and a tidy prefix, and rejects a draft with no lines', () => {
        expect(parseCalendarDay('2026-11-16')).toBe('2026-11-16');
        expect(parseCalendarDay('2026-02-31')).toBeNull();
        expect(parseCalendarDay('16-11-2026')).toBeNull();
        const settings = parsePurchaseSettings({
            purchasePrefix: 'po-',
            returnPrefix: 'প্রত্যাবর্তন',
            costMethod: 'latest',
        });
        expect(settings.ok && settings.settings).toEqual({
            purchasePrefix: 'PO',
            returnPrefix: '',
            costMethod: 'latest',
        });
        expect(parsePurchaseSettings({ purchasePrefix: 'PO', returnPrefix: 'PR', costMethod: 'nope' }).ok).toBe(
            false,
        );
        expect(parsePurchaseDraft({ supplierId: '1', purchasedOn: '2026-11-16', lines: [] }).ok).toBe(false);
        const draft = parsePurchaseDraft({
            supplierId: '1',
            purchasedOn: '2026-11-16',
            note: '  নোট  ',
            delivery: 0,
            other: 0,
            discount: 0,
            paid: 0,
            lines: [{ id: null, variantId: '9', quantity: 1, unitCost: 10000 }],
        });
        expect(draft.ok && draft.value.note).toBe('নোট');
        expect(draft.ok && draft.value.billAssetId).toBeNull();
        expect(overReceiveNeedsNote([{ quantity: 2, received: 2, add: 1 }], '')).toBe(true);
        expect(overReceiveNeedsNote([{ quantity: 2, received: 2, add: 1 }], 'extra box')).toBe(false);
        expect(overReceiveNeedsNote([{ quantity: 2, received: 1, add: 1 }], '')).toBe(false);
    });
});

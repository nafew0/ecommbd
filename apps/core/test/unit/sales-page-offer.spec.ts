import { describe, expect, it } from 'vitest';
import { type OfferLine, offerDiscount, type OfferPage } from '../../src/plugins/bd-sales-pages/offer';

const page = (overrides: Partial<OfferPage['settings']> = {}): OfferPage => ({
    productId: '1',
    settings: {
        packs: [
            { quantity: 1, price: 55_000, label: { bn: '', en: '' }, popular: false },
            { quantity: 2, price: 99_000, label: { bn: '', en: '' }, popular: true },
            { quantity: 3, price: 140_000, label: { bn: '', en: '' }, popular: false },
        ],
        bump: {
            enabled: true,
            variantId: '30',
            price: 20_000,
            title: { bn: '', en: '' },
            text: { bn: '', en: '' },
        },
        ...overrides,
    },
});

const line = (variantId: string, quantity: number, unitPrice: number, productId = '1'): OfferLine => ({
    productId,
    variantId,
    quantity,
    unitPrice,
});

describe('sales page offer prices', () => {
    it("takes the pack's price for exactly that many of the product", () => {
        // 3 × ৳550 = ৳1,650 → ৳1,400
        expect(offerDiscount(page(), [line('10', 3, 55_000)])).toBe(25_000);
        expect(offerDiscount(page(), [line('10', 2, 55_000)])).toBe(11_000);
        // One at the normal price: nothing off.
        expect(offerDiscount(page(), [line('10', 1, 55_000)])).toBe(0);
        // Four: no such pack.
        expect(offerDiscount(page(), [line('10', 4, 55_000)])).toBe(0);
    });

    it('counts every variant of the product together', () => {
        expect(offerDiscount(page(), [line('10', 1, 55_000), line('11', 2, 60_000)])).toBe(35_000);
    });

    it('gives one add-on at its special price', () => {
        const bump = line('30', 1, 35_000, '2');
        expect(offerDiscount(page(), [line('10', 2, 55_000), bump])).toBe(11_000 + 15_000);
        // Only one unit is at the special price.
        expect(offerDiscount(page(), [line('10', 1, 55_000), { ...bump, quantity: 3 }])).toBe(15_000);
        // Off, or without a price: nothing.
        const off = page({ bump: { ...page().settings.bump, enabled: false } });
        expect(offerDiscount(off, [line('10', 1, 55_000), bump])).toBe(0);
        const noPrice = page({ bump: { ...page().settings.bump, price: null } });
        expect(offerDiscount(noPrice, [line('10', 1, 55_000), bump])).toBe(0);
    });

    it('never adds to the price, and ignores other products', () => {
        // A pack dearer than the normal price takes nothing off.
        expect(offerDiscount(page(), [line('10', 2, 40_000)])).toBe(0);
        // An add-on dearer than its normal price takes nothing off either.
        expect(offerDiscount(page(), [line('10', 1, 55_000), line('30', 1, 10_000, '2')])).toBe(0);
        expect(offerDiscount(page(), [line('99', 3, 55_000, '9')])).toBe(0);
        expect(offerDiscount({ ...page(), productId: null }, [line('10', 3, 55_000)])).toBe(0);
    });
});

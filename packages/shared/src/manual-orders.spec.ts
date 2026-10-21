import { describe, expect, it } from 'vitest';
import { maxManualDiscount } from './manual-orders';
import { takaToMinor } from './money';

describe('maxManualDiscount', () => {
    it('is 10% of the subtotal in whole taka, rounded down', () => {
        expect(maxManualDiscount(takaToMinor(1250), false)).toBe(takaToMinor(125));
        expect(maxManualDiscount(takaToMinor(1259), false)).toBe(takaToMinor(125));
        expect(maxManualDiscount(0, false)).toBe(0);
    });

    it('has no limit with UnlimitedDiscount', () => {
        expect(maxManualDiscount(takaToMinor(1250), true)).toBe(Number.POSITIVE_INFINITY);
    });
});

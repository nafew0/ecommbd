import { describe, expect, it } from 'vitest';
import {
    formatTaka,
    isWholeTaka,
    minorToTaka,
    percentOfWholeTaka,
    roundToWholeTaka,
    takaToMinor,
} from './money';

describe('conversions', () => {
    it('converts taka to poisha, rounding half away from zero', () => {
        expect(takaToMinor(1350)).toBe(135000);
        expect(takaToMinor(99.5)).toBe(9950);
        expect(takaToMinor(0.005)).toBe(1);
        expect(takaToMinor(-0.005)).toBe(-1);
        expect(() => takaToMinor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('converts poisha to taka and rejects fractional poisha', () => {
        expect(minorToTaka(135000)).toBe(1350);
        expect(() => minorToTaka(1.5)).toThrow(RangeError);
    });

    it('detects whole taka', () => {
        expect(isWholeTaka(135000)).toBe(true);
        expect(isWholeTaka(135050)).toBe(false);
    });
});

describe('rounding', () => {
    it('rounds to whole taka, half away from zero', () => {
        expect(roundToWholeTaka(135050)).toBe(135100);
        expect(roundToWholeTaka(135049)).toBe(135000);
        expect(roundToWholeTaka(-150)).toBe(-200);
        expect(roundToWholeTaka(-149)).toBe(-100);
        expect(() => roundToWholeTaka(Number.NaN)).toThrow(RangeError);
    });

    it('takes a percentage and rounds to whole taka', () => {
        expect(percentOfWholeTaka(135000, 7.5)).toBe(10100);
        expect(percentOfWholeTaka(100000, 15)).toBe(15000);
        expect(percentOfWholeTaka(10000, 0.5)).toBe(100);
        expect(() => percentOfWholeTaka(135000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
        expect(() => percentOfWholeTaka(1.5, 10)).toThrow(RangeError);
    });
});

describe('formatTaka', () => {
    it.each([
        [0, '৳0'],
        [12300, '৳123'],
        [125000, '৳1,250'],
        [10000000, '৳1,00,000'],
        [1000000000, '৳1,00,00,000'],
        [9950, '৳99.50'],
        [999, '৳9.99'],
        [-15000, '-৳150'],
    ])('formats %i poisha as %s', (minor, expected) => {
        expect(formatTaka(minor)).toBe(expected);
    });

    it('supports Bangla digits, no symbol and fixed decimals', () => {
        expect(formatTaka(125000, { banglaDigits: true })).toBe('৳১,২৫০');
        expect(formatTaka(125000, { symbol: false })).toBe('1,250');
        expect(formatTaka(125000, { decimals: 'always' })).toBe('৳1,250.00');
    });

    it('rejects fractional poisha', () => {
        expect(() => formatTaka(1.5)).toThrow(RangeError);
    });
});

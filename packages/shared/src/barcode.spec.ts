import { BitArray, Code128Reader } from '@zxing/library';
import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Bars, code128Values, code128Widths } from './barcode';

/** Decodes our bars with ZXing, an independent Code 128 reader, as a scanner would. */
function scan(text: string): string {
    const { bars, modules } = code128Bars(text);
    const row = new BitArray(modules);
    for (const bar of bars) {
        for (let x = bar.x; x < bar.x + bar.width; x++) row.set(x);
    }
    return new Code128Reader().decodeRow(0, row, new Map()).getText();
}

describe('Code 128', () => {
    it('has the published pattern table: 107 symbols of 11 modules, the stop 13', () => {
        expect(CODE128_PATTERNS).toHaveLength(107);
        CODE128_PATTERNS.forEach((pattern, value) => {
            const modules = [...pattern].reduce((sum, width) => sum + Number(width), 0);
            expect(modules, `symbol ${value}`).toBe(value === 106 ? 13 : 11);
        });
        expect(new Set(CODE128_PATTERNS).size).toBe(107);
    });

    it.each([
        ['1001'],
        ['MF-1001'],
        ['12345'],
        ['SF123456789'],
        ['A1'],
        ['Order #42 / 7'],
        ['123'],
        ['0001234567890'],
        ['1234AB'],
        ['2026-10-21'],
    ])('encodes %j so a scanner reads it back', text => {
        expect(scan(text)).toBe(text);
    });

    it('uses code set C for digits: 1001 is start C, 10, 01, checksum, stop', () => {
        expect(code128Values('1001')).toEqual([105, 10, 1, (105 + 10 * 1 + 1 * 2) % 103, 106]);
        // A prefix in set B, then C for the number; an odd run starts with one digit in B.
        const mixed = code128Values('MF-12345');
        expect(mixed[0]).toBe(104);
        expect(mixed).toContain(99);
        expect(code128Values('MF-12345').length).toBeLessThan('MF-12345'.length + 3);
    });

    it('draws bars with quiet zones on both sides', () => {
        const widths = code128Widths('1001');
        const { bars, modules } = code128Bars('1001', 10);
        expect(bars[0]!.x).toBe(10);
        expect(modules).toBe(widths.reduce((sum, width) => sum + width, 0) + 20);
        expect(code128Bars('1001').modules).toBe(modules);
        // Starts and ends with a bar.
        expect(widths.length % 2).toBe(1);
    });

    it('refuses empty text and anything outside printable ASCII', () => {
        expect(() => code128Values('')).toThrow(RangeError);
        expect(() => code128Values('১০০১')).toThrow(RangeError);
        expect(() => code128Values('tab\there')).toThrow(RangeError);
    });
});

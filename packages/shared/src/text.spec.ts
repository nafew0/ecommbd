import { describe, expect, it } from 'vitest';
import { asciiToBanglaDigits, banglaToAsciiDigits, cleanText, textEquals } from './text';

describe('digits', () => {
    it('converts Bangla digits to ASCII and back', () => {
        expect(banglaToAsciiDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
        expect(banglaToAsciiDigits('মোট ৳১,২৫০')).toBe('মোট ৳1,250');
        expect(asciiToBanglaDigits('৳1,250')).toBe('৳১,২৫০');
        expect(asciiToBanglaDigits('abc')).toBe('abc');
    });
});

describe('cleanText', () => {
    it('trims and collapses whitespace on one line', () => {
        expect(cleanText('  Rahim \t\n  Uddin  ')).toBe('Rahim Uddin');
    });

    it('removes zero-width spaces, BOMs and control characters', () => {
        expect(cleanText('\uFEFFab\u200Bc\u0007d\u009F')).toBe('abcd');
    });

    it('keeps ZWJ and ZWNJ exactly, because Bangla conjuncts need them', () => {
        const rafla = 'র\u200D্যাব';
        const withZwnj = 'ক\u200C্ষ';
        expect(cleanText(rafla)).toBe(rafla);
        expect(cleanText(withZwnj)).toBe(withZwnj);
    });

    it('normalizes to NFC, so both spellings of ড় compare equal', () => {
        expect(cleanText('\u09DC')).toBe('\u09A1\u09BC');
        expect(textEquals('\u09AA\u09DC\u09BE', '\u09AA\u09A1\u09BC\u09BE')).toBe(true);
        expect(textEquals('আম', 'জাম')).toBe(false);
    });

    it('keeps emoji', () => {
        expect(cleanText(' ধন্যবাদ 🙏 ')).toBe('ধন্যবাদ 🙏');
    });

    it('keeps line breaks in multiline mode and limits blank lines to one', () => {
        expect(cleanText('  House 12  \r\nRoad 5\r\n\r\n\r\n\r\nMirpur  ', { multiline: true })).toBe(
            'House 12\nRoad 5\n\nMirpur',
        );
    });
});

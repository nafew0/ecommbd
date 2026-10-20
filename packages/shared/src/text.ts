/**
 * Text helpers for Bangla and English input.
 *
 * Rules (docs/roadmap/README.md, "Money, time, phone numbers and text"):
 * - normalize to Unicode NFC, so the same Bangla text always compares equal;
 * - never strip ZWJ (U+200D) or ZWNJ (U+200C): Bangla conjuncts depend on them;
 * - strip only zero-width spaces (U+200B) and byte-order marks (U+FEFF);
 * - accept Bangla digits wherever numbers are typed.
 */

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Zero-width space and BOM. ZWJ/ZWNJ are deliberately not included. */
const INVISIBLE = /[\u200B\uFEFF]/g;

/** C0 controls except tab, newline and carriage return; DEL; C1 controls. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Converts Bangla digits (০–৯) to ASCII digits (0–9). Other characters are unchanged. */
export function banglaToAsciiDigits(input: string): string {
    return input.replace(/[০-৯]/g, digit => String(BANGLA_DIGITS.indexOf(digit)));
}

/** Converts ASCII digits (0–9) to Bangla digits (০–৯). Other characters are unchanged. */
export function asciiToBanglaDigits(input: string): string {
    return input.replace(/[0-9]/g, digit => BANGLA_DIGITS.charAt(Number(digit)));
}

export interface CleanTextOptions {
    /** Keep line breaks (collapsing runs of blank lines). Default: false, everything on one line. */
    multiline?: boolean;
}

/**
 * Normalizes user-entered text: NFC, removes invisible and control characters,
 * collapses whitespace and trims. Safe for Bangla.
 */
export function cleanText(input: string, options: CleanTextOptions = {}): string {
    const normalized = input.normalize('NFC').replace(INVISIBLE, '').replace(CONTROL, '');
    if (!options.multiline) {
        return normalized.replace(/\s+/g, ' ').trim();
    }
    return normalized
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** True when two strings are the same after `cleanText`. */
export function textEquals(a: string, b: string): boolean {
    return cleanText(a) === cleanText(b);
}

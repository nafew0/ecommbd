/**
 * Text in sections (roadmap phase 15): every text field holds both languages; a missing one shows
 * the other language's. Cleaning follows the same rules as `cleanText` in `@ecommbd/shared` (this
 * package runs in the browser too and has no dependencies): Unicode NFC, zero-width spaces, byte
 * order marks and control characters removed, ZWJ/ZWNJ kept (Bangla conjuncts need them).
 */

export type Lang = 'bn' | 'en';

export const LANGS: readonly Lang[] = ['bn', 'en'];

export interface Bilingual {
    bn: string;
    en: string;
}

export function bilingual(bn: string, en: string = bn): Bilingual {
    return { bn, en };
}

export const EMPTY_TEXT: Bilingual = Object.freeze({ bn: '', en: '' });

/** The text in a language, or the other language's when it's empty. */
export function pick(text: Bilingual, lang: Lang): string {
    return lang === 'bn' ? text.bn || text.en : text.en || text.bn;
}

const INVISIBLE = /[\u200B\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Typed text, cleaned: one line, or lines kept (`multiline`) with runs of blank lines collapsed. */
export function cleanText(input: string, multiline = false): string {
    const normalized = input.normalize('NFC').replace(INVISIBLE, '').replace(CONTROL, '');
    if (!multiline) return normalized.replace(/\s+/g, ' ').trim();
    return normalized
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

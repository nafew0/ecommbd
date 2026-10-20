import { dhakaParts, fromDhaka } from '@ecommbd/shared/time';
import { formatTaka, takaToMinor } from '@ecommbd/shared/money';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';

/**
 * Parsing for the admin's number inputs. People type Bangla or English digits, with or without
 * commas, and we store integers in poisha and dates in UTC (shown in Dhaka time).
 */

export type TakaParseResult =
    { ok: true; minor: number | null } | { ok: false; reason: 'invalid' | 'fraction' };

/** "১,২৫০" or "1250" or "৳ 1,250" → 125000 poisha. Prices are whole taka. Empty → null. */
export function parseTakaInput(text: string): TakaParseResult {
    const cleaned = banglaToAsciiDigits(text)
        .replace(/[৳,\s]/g, '')
        .replace(/^tk\.?/i, '');
    if (cleaned === '') return { ok: true, minor: null };
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, reason: 'invalid' };
    const value = Number(cleaned);
    if (!Number.isInteger(value)) return { ok: false, reason: 'fraction' };
    return { ok: true, minor: takaToMinor(value) };
}

/** 125000 → "1,25,000" (or Bangla digits), for showing in the input. */
export function formatTakaInput(minor: number | null, banglaDigits: boolean): string {
    return minor === null ? '' : formatTaka(minor, { symbol: false, banglaDigits });
}

const pad = (value: number) => String(value).padStart(2, '0');

/** UTC ISO → the `datetime-local` value in Dhaka time ("2026-10-21T23:59"). */
export function toDhakaInputValue(iso: string | null): string {
    if (!iso) return '';
    const { year, month, day, hour, minute } = dhakaParts(new Date(iso));
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** A `datetime-local` value, read as Dhaka time → UTC ISO. Empty or malformed → null. */
export function fromDhakaInputValue(value: string): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
        number,
    ];
    return fromDhaka(year, month, day, hour, minute).toISOString();
}

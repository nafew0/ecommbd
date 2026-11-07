import { dhakaParts, fromDhaka } from '@ecommbd/shared/time';
import { formatTaka, takaToMinor } from '@ecommbd/shared/money';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';

/**
 * Parsing for the admin's number inputs. People type Bangla or English digits, with or without
 * commas, and we store integers in poisha and dates in UTC (shown in Dhaka time).
 */

export type TakaParseResult =
    { ok: true; minor: number | null } | { ok: false; reason: 'invalid' | 'fraction' };

/**
 * "১,২৫০" or "1250" or "৳ 1,250" → 125000 poisha. Prices are whole taka: "990.00" is ৳990, "990.50"
 * is refused (`fraction`), never read as 99050 or 99000 taka. Empty → null.
 */
export function parseTakaInput(text: string): TakaParseResult {
    const cleaned = banglaToAsciiDigits(text)
        .replace(/[৳,\s]/g, '')
        .replace(/^tk\.?/i, '');
    if (cleaned === '') return { ok: true, minor: null };
    // A point with nothing after it yet ("990.") is someone typing "990.00": still ৳990.
    if (!/^-?\d+(\.\d*)?$/.test(cleaned)) return { ok: false, reason: 'invalid' };
    const value = Number(cleaned);
    if (!Number.isInteger(value)) return { ok: false, reason: 'fraction' };
    return { ok: true, minor: takaToMinor(value) };
}

/**
 * What a price input that keeps its own text shows for `minor` (poisha): the merchant's text while
 * it still means that amount ("990." stays, on its way to "990.00"), else the amount in whole taka.
 * Showing the parsed amount after every key would swallow the point and turn "990.00" into 99000.
 */
export function takaInputText(typed: string, minor: number | null): string {
    const parsed = parseTakaInput(typed);
    if (parsed.ok && parsed.minor === minor) return typed;
    return minor === null ? '' : String(minor / 100);
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

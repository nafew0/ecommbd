import { CATALOG_LIMITS, parseBdMobile, sanitizeRichText, stripShortcodes } from '@ecommbd/shared';
import { createHash } from 'node:crypto';

// WooCommerce payloads vary across plugins/versions. Validate outer records and normalize each
// consumed field; never spread an upstream record into a destination entity or public response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WooRecord = Record<string, any>;
export const digest = (value: unknown) =>
    createHash('sha256')
        .update(JSON.stringify(value) ?? 'null')
        .digest('hex');
export const text = (value: unknown, max = 500) =>
    typeof value === 'string' ? value.slice(0, max).trim() : '';
export function sourceRecord(value: unknown): WooRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RECORD');
    const row = value as WooRecord;
    if (!Number.isSafeInteger(row.id) || row.id < 1) throw new Error('INVALID_SOURCE_ID');
    return row;
}
/** Parse decimal strings exactly. Legacy totals keep poisha; never use floating point here. */
export function minor(value: unknown): string {
    const raw = String(value ?? '0').trim();
    if (raw.length > 40) throw new Error('DECIMAL_OUT_OF_RANGE');
    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error('INVALID_DECIMAL');
    const [whole, fraction = ''] = raw.replace(/,/g, '').replace(/^-/, '').split('.');
    const amount = BigInt(whole) * BigInt('100') + BigInt(fraction.padEnd(2, '0'));
    if (amount > BigInt('9223372036854775807')) throw new Error('DECIMAL_OUT_OF_RANGE');
    return ((raw.startsWith('-') ? -BigInt('1') : BigInt('1')) * amount).toString();
}
export function catalogPrice(value: unknown): number {
    const amount = BigInt(minor(value));
    if (
        amount < BigInt('0') ||
        amount % BigInt('100') !== BigInt('0') ||
        amount > BigInt(CATALOG_LIMITS.maxPrice)
    )
        throw new Error('CATALOG_PRICE_NOT_WHOLE_TAKA');
    return Number(amount);
}
export function gmt(value: unknown): Date | null {
    const raw = text(value, 40);
    if (!raw || raw.startsWith('0000-')) return null;
    const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
    if (Number.isNaN(date.getTime())) throw new Error('INVALID_GMT_DATE');
    return date;
}
export function phoneOf(value: unknown): string | null {
    const result = parseBdMobile(text(value, 60));
    return result.ok && result.extras.length === 0 ? result.phone.e164 : null;
}
export const recordPhone = (row: WooRecord) => phoneOf(row.billing?.phone) || phoneOf(row.shipping?.phone);
export function localPath(value: unknown): string {
    const raw = text(value, 1000);
    if (
        !raw.startsWith('/') ||
        raw.startsWith('//') ||
        /[\\\r\n]/.test(raw) ||
        raw.includes(String.fromCharCode(0))
    )
        throw new Error('INVALID_LOCAL_PATH');
    const url = new URL(raw, 'https://migration.invalid');
    if (url.origin !== 'https://migration.invalid' || url.hash) throw new Error('INVALID_LOCAL_PATH');
    return `${url.pathname}${url.search}`;
}
export function pathOf(value: unknown, sourceUrl: string): string | null {
    try {
        const url = new URL(String(value), sourceUrl);
        if (url.origin !== new URL(sourceUrl).origin) return null;
        return localPath(`${url.pathname}${url.search}`);
    } catch {
        return null;
    }
}
export function meta(row: WooRecord, ...names: string[]): string {
    const data = Array.isArray(row.meta_data) ? row.meta_data : [];
    for (const name of names) {
        const value = data.find((entry: WooRecord) => entry.key === name)?.value;
        if (typeof value === 'string') return value;
    }
    return '';
}
export const safeDescription = (value: unknown) =>
    sanitizeRichText(stripShortcodes(text(value, 500_000)).text);
export const arrays = (value: unknown): WooRecord[] =>
    Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];

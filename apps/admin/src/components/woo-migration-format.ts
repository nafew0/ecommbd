import { formatTaka } from '@ecommbd/shared/money';
import { formatBdPhone, parseBdPhone } from '@ecommbd/shared/phone';
import { asciiToBanglaDigits } from '@ecommbd/shared/text';
import { wooDistrictName } from '@ecommbd/shared/woo';
import { ApiError } from '../lib/api';
import type { Messages } from '../messages/en';

/**
 * Plain helpers for the WooCommerce migration screens (roadmap phases 21–22): the shapes the core
 * sends back as JSON, and how each piece is put into words for the merchant. No React here, so the
 * rules can be unit tested (woo-migration-format.spec.ts).
 */

type M = Messages['migration'];

/**
 * The import's stages, in the order the core runs them. The WordPress helper runs all eight; a
 * direct REST connection runs only the first five (REST_STAGES in the core), so one list serves
 * both: a run's `cursor.stage` is an index into it either way.
 */
export const STAGES = [
    'categories',
    'tags',
    'products',
    'customers',
    'orders',
    'coupons',
    'reviews',
    'settings',
] as const;
export type Stage = (typeof STAGES)[number];

export interface WooIssue {
    id: string;
    code: string;
    kind: string;
    sourceKey: string;
    severity: string;
}

/** A migration run as `wooRun` returns it. */
export interface WooRun {
    id: string;
    status: string;
    mode: string;
    cursor: { stage: number; offset: number };
    counts: Record<string, number>;
    verification: Record<string, unknown>;
    error?: string | null;
    issues?: WooIssue[];
}

/**
 * What a run's `verification` can hold. Everything is optional: a dry run fills in fewer fields
 * than an import, and a run that's still going has only some of them.
 */
export interface Verification {
    dryRun?: boolean;
    estimatedRecords?: number;
    estimatedSeconds?: number;
    /** What the old store said it has, per kind. */
    sourceCounts?: Record<string, number>;
    /** Records recorded here per kind after an import (imported or deliberately skipped). */
    mappingCounts?: Record<string, number>;
    skippedCounts?: Record<string, number>;
    matches?: boolean;
    /** Order totals in minor units, keyed `CURRENCY:YYYY-MM` (Dhaka months). */
    expectedTotals?: Record<string, string>;
    actualTotals?: Record<string, string>;
    samples?: Array<{ sourceKey?: unknown; number?: unknown }>;
    sampleComparisons?: Array<{ sourceKey?: unknown; matches?: boolean; differentFields?: string[] }>;
    images?: number;
    readyImages?: number | null;
    imageFailures?: number;
}

/** The sitemap check's result (`crawlWooSitemap`, also kept on the source as `settings.crawl`). */
export interface CrawlResult {
    results?: Array<{ path: string; status: number; ok: boolean }>;
    checked?: number;
    passed?: boolean;
    truncated?: boolean;
    at?: string;
}

/** The old store's settings kept for reference (`settings.reference`, from the helper upload). */
export interface SourceReference {
    pixelId?: string;
    pricesIncludeTax?: boolean | null;
    shippingZones?: Array<{
        id?: unknown;
        name?: string;
        locations?: Array<{ type?: string; code?: string }>;
    }>;
    permalinks?: Record<string, string>;
    redirects?: unknown[];
}

/** An old-address rule as `wooUrlReview` lists it. */
export interface WooRedirect {
    id: string;
    path: string;
    /** Null for a 410 Gone rule. */
    target: string | null;
    hits: number;
    /** Saved by staff on this screen: imports never overwrite it. */
    manual?: boolean;
}

const has = <T extends object>(map: T, key: string): key is Extract<keyof T, string> =>
    Object.prototype.hasOwnProperty.call(map, key);

/** True when the importer's code has its own message (so the screen can also show the code itself). */
export function isKnownCode(m: M, code: string): boolean {
    return has(m.codes, code) || /^SOURCE_HTTP_\d{3}$/.test(code);
}

/**
 * One of the importer's codes in the merchant's language: an issue's `code`, or the `error` a run
 * stopped with. The messages live in one place, `codes` in messages/migration.ts. One code is
 * built from a value (`SOURCE_HTTP_404`: the old store's HTTP status), so it's matched by its
 * pattern. Anything else (a code added to the core later, or one from another plugin) gets a
 * general message that still shows the code, so support can look it up.
 */
export function codeMessage(m: M, code: string): string {
    if (has(m.codes, code)) return m.codes[code];
    const http = /^SOURCE_HTTP_(\d{3})$/.exec(code);
    if (http) return m.sourceHttp(Number(http[1]));
    return m.unknownCode(code);
}

/** A kind of record ("products", "imageHosts") in the merchant's words, or as-is if unknown. */
export function kindLabel(m: M, kind: string): string {
    return has(m.stages, kind) ? m.stages[kind] : kind;
}

/** A WooCommerce order status. Plugins add their own statuses: those show as they came. */
export function wooStatusLabel(m: M, status: string): string {
    return has(m.wooStatuses, status) ? m.wooStatuses[status] : status;
}

/**
 * What to tell the merchant when a request fails. Input errors arrive already translated by the
 * server (the `error.woo-import.*` messages in the core). Some plain errors carry one of our codes
 * (the sitemap check's `SITEMAP_READ_FAILED`, the rollback export's own `EXPORT_TOO_LARGE`…),
 * which we translate here. Anything else gets the screen's general message, never a server's
 * English error text.
 */
export function apiErrorMessage(m: M, cause: unknown): string {
    if (cause instanceof ApiError && cause.code === 'USER_INPUT_ERROR') return cause.message;
    if (cause instanceof Error && isKnownCode(m, cause.message)) return codeMessage(m, cause.message);
    return m.failed;
}

/**
 * An exact amount in minor units (poisha for taka) as the core sends it: a string, because legacy
 * totals are bigint columns. Taka goes through the shared formatter (৳1,560, or ৳১,৫৬০ in the
 * Bangla admin). Another currency the old store used keeps its code and two decimals ("USD 12.50"):
 * old orders are never converted.
 */
export function formatMinor(minor: string | number, currency: string, banglaDigits: boolean): string {
    const raw = String(minor).trim();
    if (!/^-?\d+$/.test(raw)) return raw;
    const amount = Number(raw);
    if (currency === 'BDT' && Number.isSafeInteger(amount)) return formatTaka(amount, { banglaDigits });
    // Too big for a JS number, or not taka: split the digits instead, so nothing is rounded.
    const sign = raw.startsWith('-') ? '-' : '';
    const digits = raw.replace(/^-/, '').padStart(3, '0');
    const text = `${currency} ${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`.trim();
    return banglaDigits ? asciiToBanglaDigits(text) : text;
}

/**
 * A WooCommerce decimal ("1,560.00", or a bare number) in minor units, as a string, without
 * floating point (the same rule as `minor()` in the core). Null when it isn't an amount.
 */
export function decimalToMinor(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const raw = String(value).trim().replace(/,/g, '');
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
    if (!match) return null;
    const minor = BigInt(match[2]!) * BigInt(100) + BigInt((match[3] ?? '').padEnd(2, '0'));
    return `${match[1] && minor > BigInt(0) ? '-' : ''}${minor.toString()}`;
}

/**
 * The dry run's estimate (`estimatedSeconds`) as "About 25 minutes". Past an hour, quarter hours
 * are as precise as an estimate can honestly be. Null when the core sent no estimate (older runs,
 * or a run still going), so the screen shows nothing rather than a guess.
 */
export function formatDuration(m: M, seconds: unknown): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
    if (seconds < 60) return m.duration.underMinute;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return m.duration.minutes(minutes);
    const quarters = Math.round(minutes / 15) * 15;
    return m.duration.hours(Math.floor(quarters / 60), quarters % 60);
}

/** A `YYYY-MM` month from the totals ("October 2026"); `unknown` is orders with no date. */
export function monthLabel(m: M, month: string, banglaDigits: boolean): string {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const name = match && m.months[Number(match[2]) - 1];
    if (!match || !name) return month === 'unknown' ? m.report.unknownMonth : month;
    return `${name} ${banglaDigits ? asciiToBanglaDigits(match[1]!) : match[1]}`;
}

/** One row of the "records by type" table. Missing numbers mean the run didn't measure them. */
export interface CountRow {
    kind: string;
    /** What the old store said it has. */
    expected?: number;
    /** Read by a dry run, or recorded here by an import. */
    actual?: number;
    skipped?: number;
    /** Undefined when there's nothing to compare. */
    matches?: boolean;
}

/**
 * The per-kind comparison, in stage order. A dry run compares what it read with what the old
 * store reported; an import compares what's recorded here (`mappingCounts`, the number the core
 * itself checks). The core doesn't record coupons, reviews or settings that way, so after an
 * import those rows show the old store's count with no verdict.
 */
export function countRows(v: Verification, counts: Record<string, number>, dryRun: boolean): CountRow[] {
    const actual = dryRun ? counts : (v.mappingCounts ?? {});
    return STAGES.filter(kind => v.sourceCounts?.[kind] != null || actual[kind] != null).map(kind => {
        const expected = v.sourceCounts?.[kind];
        const done = actual[kind];
        return {
            kind,
            expected,
            actual: done,
            skipped: dryRun ? undefined : v.skippedCounts?.[kind],
            matches: expected == null || done == null ? undefined : expected === done,
        };
    });
}

export interface TotalRow {
    currency: string;
    month: string;
    expected?: string;
    actual?: string;
    matches?: boolean;
}

/**
 * Monthly order totals per currency, oldest first. Only an import has `actualTotals` (what was
 * saved here); a dry run shows the old store's side alone.
 */
export function totalRows(v: Verification): TotalRow[] {
    const expected = v.expectedTotals ?? {};
    const actual = v.actualTotals;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual ?? {})])];
    return keys
        .map(key => {
            const split = key.indexOf(':');
            return {
                currency: key.slice(0, split),
                month: key.slice(split + 1),
                expected: expected[key],
                actual: actual?.[key],
                matches: actual ? expected[key] === actual[key] : undefined,
            };
        })
        .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

export interface SampleSummary {
    total: number;
    passed: number;
    /** The orders that differ: their old order number, and which parts differ. */
    failed: Array<{ order: string; fields: string[] }>;
}

/**
 * The import's spot checks: up to 20 old orders compared field by field with the copy saved here.
 * The comparison holds only the WooCommerce order ID, so the order number (what merchants know)
 * is looked up in the samples taken during the import.
 */
export function sampleSummary(v: Verification): SampleSummary | null {
    const comparisons = v.sampleComparisons;
    if (!comparisons?.length) return null;
    const numbers = new Map(
        (v.samples ?? []).map(s => [String(s.sourceKey), String(s.number ?? s.sourceKey)]),
    );
    const failed = comparisons
        .filter(c => !c.matches)
        .map(c => ({
            order: numbers.get(String(c.sourceKey)) ?? String(c.sourceKey),
            fields: c.differentFields ?? [],
        }));
    return { total: comparisons.length, passed: comparisons.length - failed.length, failed };
}

export interface IssueGroup {
    code: string;
    severity: string;
    issues: WooIssue[];
}

/**
 * Issues grouped by code, so 40 "address needs review" rows read as one line with 40 records.
 * Errors (they block a clean import) come first, then the groups that affect the most records.
 */
export function groupIssues(issues: WooIssue[]): IssueGroup[] {
    const groups = new Map<string, IssueGroup>();
    for (const issue of issues) {
        const key = `${issue.severity}:${issue.code}`;
        const group = groups.get(key) ?? { code: issue.code, severity: issue.severity, issues: [] };
        group.issues.push(issue);
        groups.set(key, group);
    }
    return [...groups.values()].sort(
        (a, b) =>
            Number(b.severity === 'error') - Number(a.severity === 'error') ||
            b.issues.length - a.issues.length,
    );
}

/**
 * An old-store path as people read it. The core keeps paths percent-encoded
 * (`/product/%e0%a6%b2…/`), which is unreadable for a Bangla address, so it's decoded for display.
 * `decodeURI` leaves encoded separators (`%2F`, `%3F`) alone, so the path still means the same; a
 * broken escape shows as stored.
 */
export function readablePath(path: string): string {
    try {
        return decodeURI(path);
    } catch {
        return path;
    }
}

/** How many record references one issue line lists before "and N more". */
const RECORDS_SHOWN = 12;

/**
 * Which records an issue group is about, by kind: "Products: #12, #15". Some keys mean nothing to
 * a merchant and are left out: images are keyed by a hash of their URL, the settings record is
 * always "1", and a whole-stage issue (a count mismatch) has no key. Image hosts are keyed by the
 * host name itself, so that's shown without a "#".
 */
export function issueRecords(m: M, issues: WooIssue[]): string[] {
    const byKind = new Map<string, string[]>();
    for (const issue of issues) {
        if (!issue.sourceKey || issue.kind === 'images' || issue.kind === 'settings') continue;
        const keys = byKind.get(issue.kind) ?? [];
        keys.push(issue.kind === 'imageHosts' ? issue.sourceKey : `#${issue.sourceKey}`);
        byKind.set(issue.kind, keys);
    }
    return [...byKind].map(([kind, keys]) => {
        const shown = keys.slice(0, RECORDS_SHOWN).join(', ');
        const rest = keys.length - RECORDS_SHOWN;
        return `${kindLabel(m, kind)}: ${shown}${rest > 0 ? ` ${m.more(rest)}` : ''}`;
    });
}

/** What a failing URL's status means. Status 0 is the core's "no answer at all". */
export function crawlStatusLabel(m: M, status: number): string {
    if (status === 0) return m.crawlStatus.noAnswer;
    if (status === 404) return m.crawlStatus.notFound;
    if (status === 410) return m.crawlStatus.gone;
    // The check already followed one redirect on our site, so another 3xx means a chain (or a
    // redirect off the site): either way, not the single hop search engines want.
    if (status >= 300 && status < 400) return m.crawlStatus.redirect(status);
    if (status >= 500) return m.crawlStatus.server(status);
    return m.crawlStatus.other(status);
}

/**
 * A WooCommerce "state" as a district name: `BD-13` (an address) or `BD:BD-13` (a shipping zone)
 * becomes "Dhaka" (the codes are WooCommerce's own, shared with the importer in
 * `@ecommbd/shared/woo`). Anything else (a typed-in name, another country's state) shows as it
 * came. The name stays in English: it's the old store's data, not one of our translated lists.
 */
export function wooDistrict(state: string): string {
    return wooDistrictName(state) ?? state.trim();
}

export interface AddressLines {
    name: string;
    /** `e164` is set when the number is a valid Bangladeshi one (then it can be dialled). */
    phone: { display: string; e164?: string } | null;
    address: string;
    district: string;
}

const field = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * A WooCommerce billing or shipping address (as kept in a legacy order) as the four things staff
 * look for: name, phone, address, district. WooCommerce's "city" is where BD shoppers usually type
 * their area or thana, so it joins the address line. Company and email are left out on purpose:
 * BD merchants don't use them, and an email could be a phone-only placeholder. Null when empty.
 */
export function addressLines(value: unknown): AddressLines | null {
    if (!value || typeof value !== 'object') return null;
    const a = value as Record<string, unknown>;
    const name = `${field(a.first_name)} ${field(a.last_name)}`.trim();
    const rawPhone = field(a.phone);
    const parsed = rawPhone ? parseBdPhone(rawPhone) : null;
    const phone = parsed?.ok
        ? { display: formatBdPhone(parsed.phone.e164), e164: parsed.phone.e164 }
        : rawPhone
          ? { display: rawPhone }
          : null;
    const address = [field(a.address_1), field(a.address_2), field(a.city), field(a.postcode)]
        .filter(Boolean)
        .join(', ');
    const country = field(a.country);
    const district = [wooDistrict(field(a.state)), country && country !== 'BD' ? country : '']
        .filter(Boolean)
        .join(', ');
    if (!name && !phone && !address && !district) return null;
    return { name, phone, address, district };
}

/** True when two WooCommerce addresses would read the same on screen (so one block is enough). */
export function sameAddress(a: unknown, b: unknown): boolean {
    return JSON.stringify(addressLines(a)) === JSON.stringify(addressLines(b));
}

/**
 * A shipping zone's locations, grouped by type: "Districts: Dhaka, Gazipur". WooCommerce writes a
 * Bangladeshi district as `BD:BD-13`, which `wooDistrict` turns into its name.
 */
export function zoneLocations(m: M, locations: Array<{ type?: string; code?: string }> = []): string[] {
    const byType = new Map<string, string[]>();
    for (const location of locations) {
        const type = location.type ?? '';
        const code = (location.code ?? '').trim();
        if (!code) continue;
        const names = byType.get(type) ?? [];
        names.push(type === 'state' ? wooDistrict(code) : code);
        byType.set(type, names);
    }
    return [...byType].map(
        ([type, names]) =>
            `${has(m.locationTypes, type) ? m.locationTypes[type] : type}: ${names.join(', ')}`,
    );
}

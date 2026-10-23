import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { bn } from '../messages/bn';
import { en } from '../messages/en';
import {
    addressLines,
    apiErrorMessage,
    codeMessage,
    countRows,
    crawlStatusLabel,
    decimalToMinor,
    formatDuration,
    formatMinor,
    groupIssues,
    issueRecords,
    monthLabel,
    readablePath,
    sameAddress,
    sampleSummary,
    totalRows,
    wooDistrict,
    wooStatusLabel,
    zoneLocations,
} from './woo-migration-format';

/** How the WooCommerce migration screens put the importer's JSON and codes into words. */

const m = en.migration;
const b = bn.migration;
const root = path.resolve(__dirname, '../../../..');

describe('importer codes', () => {
    it('has a message for every code the core and the WordPress helper can raise', () => {
        const dir = path.join(root, 'apps/core/src/plugins/woo-import');
        const source = fs
            .readdirSync(dir)
            .filter(file => file.endsWith('.ts'))
            .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
            .join('\n');
        // Every quoted UPPER_SNAKE string in the plugin is a code, except these.
        const notCodes = new Set(['WOO_OPTIONS', 'FALSE', 'TRUE']);
        const codes = [...source.matchAll(/'([A-Z][A-Z0-9_]{4,})'/g)]
            .map(match => match[1]!)
            .filter(code => !notCodes.has(code));
        // The WordPress helper's warnings about the old site (`$warnings[] = 'CODE';`), which the
        // core records as settings issues.
        const helperDir = path.join(root, 'apps/wp-migrator/includes');
        const helper = fs
            .readdirSync(helperDir)
            .filter(file => file.endsWith('.php'))
            .map(file => fs.readFileSync(path.join(helperDir, file), 'utf8'))
            .join('\n');
        const warnings = [...helper.matchAll(/\$warnings\[\]\s*=\s*'([A-Z][A-Z0-9_]+)'/g)].map(
            match => match[1]!,
        );
        expect(warnings.length).toBeGreaterThan(0);
        codes.push(...warnings);
        // `SOURCE_${HttpError kind}` from the REST connector (HttpErrorKind in packages/shared/src/http.ts).
        codes.push(
            ...['timeout', 'network', 'blocked', 'too_large', 'too_many_redirects', 'circuit_open'].map(
                kind => `SOURCE_${kind.toUpperCase()}`,
            ),
        );
        expect(codes.length).toBeGreaterThan(60);
        expect([...new Set(codes)].filter(code => !(code in m.codes))).toEqual([]);
    });

    it('translates known codes, builds HTTP statuses, and shows unknown codes as they are', () => {
        expect(codeMessage(m, 'ADDRESS_NEEDS_REVIEW')).toMatch(/district or thana/);
        expect(codeMessage(b, 'ADDRESS_NEEDS_REVIEW')).toMatch(/জেলা বা থানা/);
        expect(codeMessage(m, 'SOURCE_HTTP_404')).toMatch(/error 404/);
        expect(codeMessage(b, 'SOURCE_HTTP_503')).toMatch(/৫০৩/);
        expect(codeMessage(m, 'SOMETHING_NEW')).toMatch(/code SOMETHING_NEW/);
        // Inherited object keys are not codes.
        expect(codeMessage(m, 'constructor')).toMatch(/code constructor/);
    });

    it('says what went wrong without leaking server English', () => {
        expect(apiErrorMessage(m, new ApiError('Translated by the server', 'USER_INPUT_ERROR'))).toBe(
            'Translated by the server',
        );
        expect(apiErrorMessage(m, new ApiError('SITEMAP_READ_FAILED', 'INTERNAL_SERVER_ERROR'))).toBe(
            m.codes.SITEMAP_READ_FAILED,
        );
        expect(apiErrorMessage(m, new Error('EXPORT_TOO_LARGE'))).toBe(m.codes.EXPORT_TOO_LARGE);
        expect(apiErrorMessage(m, new ApiError('relation "x" does not exist', 'INTERNAL_SERVER_ERROR'))).toBe(
            m.failed,
        );
    });

    it('names WooCommerce order statuses, keeping a plugin’s own as it came', () => {
        expect(wooStatusLabel(m, 'on-hold')).toBe('On hold');
        expect(wooStatusLabel(b, 'processing')).toBe('প্রসেসিং');
        expect(wooStatusLabel(m, 'wc-shipped-custom')).toBe('wc-shipped-custom');
    });
});

describe('amounts, months and durations', () => {
    it('formats exact minor-unit strings: taka with the shared formatter, other currencies as they were', () => {
        expect(formatMinor('156000', 'BDT', false)).toBe('৳1,560');
        expect(formatMinor('156050', 'BDT', true)).toBe('৳১,৫৬০.৫০');
        expect(formatMinor('1250', 'USD', false)).toBe('USD 12.50');
        expect(formatMinor('-5', 'USD', false)).toBe('USD -0.05');
        // Too big for a JS number: split as text, nothing rounded.
        expect(formatMinor('123456789012345678', 'BDT', false)).toBe('BDT 1234567890123456.78');
    });

    it('reads WooCommerce decimals without floating point', () => {
        expect(decimalToMinor('1560.00')).toBe('156000');
        expect(decimalToMinor('1,560.5')).toBe('156050');
        expect(decimalToMinor(60)).toBe('6000');
        expect(decimalToMinor('-0.00')).toBe('0');
        expect(decimalToMinor('free')).toBeNull();
        expect(decimalToMinor(undefined)).toBeNull();
    });

    it('turns the estimate into minutes and hours, and shows nothing without one', () => {
        expect(formatDuration(m, undefined)).toBeNull();
        expect(formatDuration(m, 'soon')).toBeNull();
        expect(formatDuration(m, 30)).toBe('Under a minute');
        expect(formatDuration(m, 61)).toBe('About 2 minutes');
        expect(formatDuration(m, 60)).toBe('About 1 minute');
        expect(formatDuration(m, 2 * 3600 + 14 * 60)).toBe('About 2 hours 15 minutes');
        expect(formatDuration(m, 3600)).toBe('About 1 hour');
        expect(formatDuration(b, 25 * 60)).toBe('প্রায় ২৫ মিনিট');
        expect(formatDuration(b, 90 * 60)).toBe('প্রায় ১ ঘণ্টা ৩০ মিনিট');
    });

    it('names months, and orders without a date', () => {
        expect(monthLabel(m, '2026-10', false)).toBe('October 2026');
        expect(monthLabel(b, '2026-01', true)).toBe('জানুয়ারি ২০২৬');
        expect(monthLabel(m, 'unknown', false)).toBe('No date');
    });
});

describe('the run report', () => {
    it('compares a dry run’s reads with what the old store reported', () => {
        const rows = countRows(
            { sourceCounts: { products: 3, orders: 2 } },
            { products: 3, orders: 1, written: 4 },
            true,
        );
        expect(rows).toEqual([
            { kind: 'products', expected: 3, actual: 3, skipped: undefined, matches: true },
            { kind: 'orders', expected: 2, actual: 1, skipped: undefined, matches: false },
        ]);
    });

    it('compares an import’s recorded records, with no verdict where the core has nothing to compare', () => {
        const rows = countRows(
            {
                sourceCounts: { products: 3, coupons: 1 },
                mappingCounts: { products: 3 },
                skippedCounts: { products: 1 },
            },
            {},
            false,
        );
        expect(rows).toEqual([
            { kind: 'products', expected: 3, actual: 3, skipped: 1, matches: true },
            { kind: 'coupons', expected: 1, actual: undefined, skipped: undefined, matches: undefined },
        ]);
    });

    it('lists monthly totals per currency, oldest first', () => {
        const rows = totalRows({
            expectedTotals: { 'BDT:2026-10': '156000', 'USD:2026-09': '1250', 'BDT:unknown': '100' },
            actualTotals: { 'BDT:2026-10': '156000', 'USD:2026-09': '1200' },
        });
        expect(rows.map(row => [row.currency, row.month, row.matches])).toEqual([
            ['USD', '2026-09', false],
            ['BDT', '2026-10', true],
            ['BDT', 'unknown', false],
        ]);
        expect(totalRows({ expectedTotals: { 'BDT:2026-10': '1' } })[0]!.matches).toBeUndefined();
    });

    it('names failed sample orders by their order number', () => {
        expect(
            sampleSummary({
                samples: [{ sourceKey: '16', number: 'W-1016' }],
                sampleComparisons: [
                    { sourceKey: '16', matches: false, differentFields: ['total'] },
                    { sourceKey: '17', matches: true, differentFields: [] },
                ],
            }),
        ).toEqual({ total: 2, passed: 1, failed: [{ order: 'W-1016', fields: ['total'] }] });
        expect(sampleSummary({})).toBeNull();
    });

    it('groups issues by code, errors first, and lists the records merchants can find', () => {
        const issue = (id: string, code: string, kind: string, sourceKey: string, severity = 'warning') => ({
            id,
            code,
            kind,
            sourceKey,
            severity,
        });
        const groups = groupIssues([
            issue('1', 'ADDRESS_NEEDS_REVIEW', 'customers', '3'),
            issue('2', 'ADDRESS_NEEDS_REVIEW', 'orders', '16'),
            issue('3', 'SOURCE_COUNT_MISMATCH', 'orders', '', 'error'),
            issue('4', 'IMAGE_FAILED_OR_UNAPPROVED', 'images', 'a1b2c3'),
            issue('5', 'IMAGE_HOST_NOT_APPROVED', 'imageHosts', 'cdn.example.com'),
        ]);
        expect(groups.map(group => group.code)).toEqual([
            'SOURCE_COUNT_MISMATCH',
            'ADDRESS_NEEDS_REVIEW',
            'IMAGE_FAILED_OR_UNAPPROVED',
            'IMAGE_HOST_NOT_APPROVED',
        ]);
        expect(issueRecords(m, groups[1]!.issues)).toEqual(['Customers: #3', 'Orders: #16']);
        expect(issueRecords(m, groups[0]!.issues)).toEqual([]);
        expect(issueRecords(m, groups[2]!.issues)).toEqual([]);
        expect(issueRecords(m, groups[3]!.issues)).toEqual(['Image hosts: cdn.example.com']);
        const many = Array.from({ length: 15 }, (_, i) => issue(String(i), 'X', 'products', String(i)));
        expect(issueRecords(m, many)[0]).toMatch(/#11 and 3 more$/);
    });

    it('decodes stored paths for reading, keeping encoded separators', () => {
        expect(readablePath('/product/%e0%a6%b2%e0%a6%be%e0%a6%b2/')).toBe('/product/লাল/');
        expect(readablePath('/a%2Fb/')).toBe('/a%2Fb/');
        expect(readablePath('/broken-%e0%a6/')).toBe('/broken-%e0%a6/');
    });

    it('explains failing sitemap URLs', () => {
        expect(crawlStatusLabel(m, 0)).toBe('No answer');
        expect(crawlStatusLabel(m, 404)).toBe('Not found (404)');
        expect(crawlStatusLabel(m, 301)).toBe('Redirects more than once (301)');
        expect(crawlStatusLabel(m, 502)).toBe('Server error (502)');
        expect(crawlStatusLabel(m, 403)).toBe('Error 403');
    });
});

describe('WooCommerce addresses and zones', () => {
    const billing = {
        first_name: 'Synthetic',
        last_name: 'Customer',
        company: 'Ignored Ltd',
        address_1: 'House 12 Road 5',
        address_2: '',
        city: 'Dhanmondi',
        state: 'BD-13',
        postcode: '1209',
        country: 'BD',
        email: 'synthetic@example.com',
        phone: '01712345678',
    };

    it('reads WooCommerce district codes', () => {
        expect(wooDistrict('BD-13')).toBe('Dhaka');
        expect(wooDistrict('BD:BD-10')).toBe('Chattogram');
        expect(wooDistrict('BD-99')).toBe('BD-99');
        expect(wooDistrict('Sylhet')).toBe('Sylhet');
    });

    it('shows name, phone, address and district, and leaves out company and email', () => {
        expect(addressLines(billing)).toEqual({
            name: 'Synthetic Customer',
            phone: { display: '01712-345678', e164: '+8801712345678' },
            address: 'House 12 Road 5, Dhanmondi, 1209',
            district: 'Dhaka',
        });
        expect(addressLines({ phone: 'call me' })?.phone).toEqual({ display: 'call me' });
        expect(addressLines({ country: 'US', state: 'CA' })?.district).toBe('CA, US');
        expect(addressLines({ first_name: '', country: '' })).toBeNull();
        expect(addressLines(null)).toBeNull();
    });

    it('treats a delivery address that reads the same as billing as one address', () => {
        expect(sameAddress(billing, { ...billing, email: '' })).toBe(true);
        expect(sameAddress(billing, { ...billing, city: 'Mirpur' })).toBe(false);
    });

    it('groups a shipping zone’s locations by type', () => {
        expect(
            zoneLocations(m, [
                { type: 'state', code: 'BD:BD-13' },
                { type: 'state', code: 'BD:BD-18' },
                { type: 'postcode', code: '1209' },
            ]),
        ).toEqual(['Districts: Dhaka, Gazipur', 'Postcodes: 1209']);
    });
});

import { describe, expect, it } from 'vitest';
import { BdAddressError, normalizeAddressInput } from '../../src/plugins/bd-core/address/normalize-address';
import { districtList, thanaList, toGeoLanguage } from '../../src/plugins/bd-core/geo/geo-lists';
import { mergeDefaults } from '../../src/plugins/bd-core/settings/store-settings.service';
import { contentSecurityPolicy } from '../../src/plugins/merchant-admin/merchant-admin.plugin';

const DHAKA = 'BD3026';
const MIRPUR = 'BD3026M26';

function codeOf(run: () => unknown): string | undefined {
    try {
        run();
    } catch (error) {
        return error instanceof BdAddressError ? error.code : String(error);
    }
    return undefined;
}

describe('normalizeAddressInput', () => {
    it('passes addresses without our fields through unchanged', () => {
        const input = { countryCode: 'GB', city: 'London' };
        expect(normalizeAddressInput(input)).toBe(input);
    });

    it('fills city and province from the IDs and cleans text', () => {
        expect(
            normalizeAddressInput({
                countryCode: 'BD',
                city: 'typed by hand',
                customFields: {
                    districtId: ` ${DHAKA} `,
                    thanaId: MIRPUR,
                    area: ' Mirpur  10 ',
                    landmark: '  ',
                },
            }),
        ).toEqual({
            countryCode: 'BD',
            city: 'Mirpur',
            province: 'Dhaka',
            customFields: { districtId: DHAKA, thanaId: MIRPUR, area: 'Mirpur 10', landmark: null },
        });
    });

    it('stores the alternate phone as E.164, accepting Bangla digits and landlines', () => {
        const normalized = (alternatePhone: string | null) =>
            normalizeAddressInput({ customFields: { alternatePhone } }).customFields?.alternatePhone;
        expect(normalized('০১৭১২-৩৪৫৬৭৮')).toBe('+8801712345678');
        expect(normalized('02-9123456')).toBe('+88029123456');
        expect(normalized('')).toBeNull();
        expect(normalized(null)).toBeNull();
        expect(codeOf(() => normalized('12345'))).toBe('invalid-alternate-phone');
    });

    it('leaves fields that an update does not send untouched', () => {
        expect(normalizeAddressInput({ customFields: { landmark: 'Near the mosque' } })).toEqual({
            customFields: { landmark: 'Near the mosque' },
        });
        expect(normalizeAddressInput({ customFields: { districtId: null, thanaId: '' } })).toEqual({
            customFields: { districtId: null, thanaId: null },
        });
    });

    it('rejects places that do not fit together', () => {
        const check = (customFields: Record<string, string | null>, countryCode = 'BD') =>
            codeOf(() => normalizeAddressInput({ countryCode, customFields }));
        expect(check({ districtId: DHAKA })).toBe('district-and-thana-together');
        expect(check({ thanaId: MIRPUR })).toBe('district-and-thana-together');
        expect(check({ districtId: 'BD9999', thanaId: MIRPUR })).toBe('unknown-district');
        expect(check({ districtId: 'BD4050', thanaId: MIRPUR })).toBe('thana-not-in-district');
        expect(check({ districtId: DHAKA, thanaId: 'other' })).toBe('other-needs-area');
        expect(check({ districtId: DHAKA, thanaId: MIRPUR }, 'IN')).toBe('not-bangladesh');
        expect(check({ districtId: DHAKA, thanaId: MIRPUR }, 'bd')).toBeUndefined();
    });

    it('uses the written area as the city for "Other / not listed"', () => {
        expect(
            normalizeAddressInput({
                customFields: { districtId: DHAKA, thanaId: 'other', area: 'Purbachal' },
            }),
        ).toMatchObject({ city: 'Purbachal', province: 'Dhaka' });
    });
});

describe('geo lists', () => {
    it('sorts by name in the requested language and caches', () => {
        expect(districtList('en')[0]!.name).toBe('Bagerhat');
        expect(districtList('bn')[0]!.name).toBe(districtList('bn')[0]!.nameBn);
        expect(districtList('en')).toBe(districtList('en'));
        expect(thanaList(DHAKA, 'bn').find(thana => thana.id === MIRPUR)?.name).toBe('মিরপুর');
        expect(thanaList('nowhere', 'en')).toEqual([]);
    });

    it('accepts only bn or en, with a fallback', () => {
        expect(toGeoLanguage('bn')).toBe('bn');
        expect(toGeoLanguage('fr')).toBe('en');
        expect(toGeoLanguage(undefined, 'bn')).toBe('bn');
    });
});

describe('mergeDefaults', () => {
    it('fills keys that older saved settings do not have, keeping saved values and arrays', () => {
        const defaults = { a: 1, nested: { b: 2, c: 3 }, list: [1, 2] };
        expect(mergeDefaults(defaults, { nested: { b: 5 }, list: [] })).toEqual({
            a: 1,
            nested: { b: 5, c: 3 },
            list: [],
        });
        expect(mergeDefaults(defaults, undefined)).toEqual(defaults);
    });
});

describe('contentSecurityPolicy', () => {
    it('allows only this origin for scripts, styles, fonts and API calls', () => {
        const csp = contentSecurityPolicy();
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("connect-src 'self'");
        expect(csp).not.toContain('unsafe-inline');
        expect(csp).toContain("img-src 'self' data: blob:;");
        expect(contentSecurityPolicy(['https://cdn.example.com'])).toContain(
            "img-src 'self' data: blob: https://cdn.example.com;",
        );
    });

    it('frames only this origin, plus the storefront for the page editor’s preview', () => {
        expect(contentSecurityPolicy()).toContain("frame-src 'self';");
        expect(contentSecurityPolicy([], ['http://localhost:4321'])).toContain(
            "frame-src 'self' http://localhost:4321;",
        );
        expect(contentSecurityPolicy()).toContain("frame-ancestors 'none'");
    });
});

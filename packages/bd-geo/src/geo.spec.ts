import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    allUnits,
    dataSources,
    dataVersion,
    DELIVERY_ZONES,
    findById,
    findDistrict,
    findThana,
    getDistricts,
    getDivisions,
    getThanas,
    isThanaInDistrict,
    nameOf,
    OTHER_THANA_ID,
    sortByName,
    zoneOf,
} from './geo';

const DHAKA = 'BD3026';
const CHATTOGRAM = 'BD2015';
const KUSHTIA = 'BD4050';

/** Finds a thana by English name inside a district (tests only: real code always uses IDs). */
function thanaNamed(districtId: string, en: string) {
    const thana = getThanas(districtId).find(unit => unit.en === en);
    if (!thana) {
        throw new Error(`No ${en} in ${districtId}`);
    }
    return thana;
}

describe('dataset integrity', () => {
    it('has 8 divisions and 64 districts', () => {
        expect(getDivisions()).toHaveLength(8);
        expect(getDistricts()).toHaveLength(64);
    });

    it('has every upazila (495), the 12 city corporations and the Dhaka and Chattogram metro thanas', () => {
        const thanas = allUnits().filter(unit => unit.kind === 'thana');
        const count = (type: string) => thanas.filter(unit => unit.type === type).length;
        expect(count('upazila')).toBe(495);
        expect(count('city_corporation')).toBe(12);
        expect(count('metro_thana')).toBe(65);
    });

    it('gives every district a division and every thana a district', () => {
        const divisionIds = new Set(getDivisions().map(unit => unit.id));
        for (const district of getDistricts()) {
            expect(divisionIds.has(district.divisionId)).toBe(true);
            expect(getThanas(district.id).length).toBeGreaterThan(0);
        }
        for (const unit of allUnits()) {
            if (unit.kind === 'thana') {
                expect(findDistrict(unit.districtId), unit.id).toBeDefined();
            }
        }
    });

    it('uses unique IDs in the documented formats', () => {
        const ids = allUnits().map(unit => unit.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const unit of allUnits()) {
            if (unit.kind === 'division') {
                expect(unit.id).toMatch(/^BD\d{2}$/);
            } else if (unit.kind === 'district') {
                expect(unit.id).toMatch(new RegExp(`^${unit.divisionId}\\d{2}$`));
            } else if (unit.type === 'metro_thana') {
                expect(unit.id).toMatch(new RegExp(`^${unit.districtId}M\\d{2}$`));
            } else {
                expect(unit.id).toMatch(new RegExp(`^${unit.districtId}\\d{4}$`));
            }
        }
    });

    it('has both names for everything, trimmed and NFC-normalized, in the right script', () => {
        for (const unit of allUnits()) {
            for (const text of [unit.en, unit.bn, ...unit.aliases]) {
                expect(text, unit.id).toBe(text.normalize('NFC'));
                expect(text, unit.id).toBe(text.trim());
            }
            expect(unit.en, unit.id).toMatch(/^[A-Za-z][A-Za-z '()./-]*$/);
            expect(unit.bn, unit.id).toMatch(/^[\u0980-\u09FF](?:[\u0980-\u09FF ]|\u200C|\u200D)*$/);
        }
    });

    it('keeps names unique inside a district, so a picker never shows two identical options', () => {
        for (const district of getDistricts()) {
            const thanas = getThanas(district.id);
            expect(new Set(thanas.map(unit => unit.en)).size, district.en).toBe(thanas.length);
            expect(new Set(thanas.map(unit => unit.bn)).size, district.en).toBe(thanas.length);
        }
    });

    it('only uses known delivery zones', () => {
        for (const unit of allUnits()) {
            if (unit.kind === 'thana') {
                expect(DELIVERY_ZONES).toContain(unit.zone);
            }
        }
    });

    it('carries a version and its sources for attribution', () => {
        expect(dataVersion).toMatch(/^\d{4}\.\d+$/);
        expect(dataSources.join(' ')).toContain('BBS');
        expect(dataSources.join(' ')).toContain('nuhil/bangladesh-geocode');
    });

    it('keeps what the checkout loads small (district list, and the biggest district’s thanas)', () => {
        const gz = (value: unknown) => gzipSync(JSON.stringify(value)).length;
        const districts = getDistricts().map(({ id, en, bn }) => ({ id, en, bn }));
        const biggest = Math.max(
            ...getDistricts().map(district =>
                gz(getThanas(district.id).map(({ id, en, bn }) => ({ id, en, bn }))),
            ),
        );
        expect(gz(districts)).toBeLessThan(15 * 1024);
        expect(biggest).toBeLessThan(15 * 1024);
        // The whole file (all units, aliases and zones) is measured too, for the README.
        const full = gzipSync(readFileSync(join(__dirname, 'data/bd-geo.json'))).length;
        expect(full).toBeLessThan(20 * 1024);
    });
});

describe('lookups', () => {
    it('finds units by ID', () => {
        expect(findById(DHAKA)?.en).toBe('Dhaka');
        expect(findById('BD30')?.kind).toBe('division');
        expect(findDistrict('BD30')).toBeUndefined();
        expect(findThana(DHAKA)).toBeUndefined();
        expect(findThana('BD30260072')?.en).toBe('Savar');
        expect(findById('nowhere')).toBeUndefined();
    });

    it('lists the districts of one division', () => {
        const sylhet = getDistricts('BD60').map(unit => unit.en);
        expect(sylhet).toEqual(['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet']);
    });

    it('lists metro thanas instead of city corporation units in Dhaka and Chattogram', () => {
        const dhaka = getThanas(DHAKA);
        expect(dhaka.some(unit => unit.type === 'city_corporation')).toBe(false);
        expect(dhaka.filter(unit => unit.type === 'metro_thana')).toHaveLength(50);
        expect(dhaka.filter(unit => unit.type === 'upazila').map(unit => unit.en)).toEqual([
            'Dhamrai',
            'Dohar',
            'Keraniganj',
            'Nawabganj',
            'Savar',
        ]);
        expect(getThanas(CHATTOGRAM).some(unit => unit.type === 'city_corporation')).toBe(false);
    });

    it('lists the city corporation unit where no metro thanas are listed', () => {
        expect(getThanas('BD4047').map(unit => unit.en)).toContain('Khulna City Corporation');
        expect(getThanas('nowhere')).toEqual([]);
    });

    it('checks that a thana belongs to a district, by ID', () => {
        const mirpurDhaka = thanaNamed(DHAKA, 'Mirpur');
        expect(isThanaInDistrict(DHAKA, mirpurDhaka.id)).toBe(true);
        expect(isThanaInDistrict(KUSHTIA, mirpurDhaka.id)).toBe(false);
        expect(isThanaInDistrict(DHAKA, OTHER_THANA_ID)).toBe(false);
        expect(isThanaInDistrict(DHAKA, DHAKA)).toBe(false);
    });

    it('keeps places with the same name apart (Sadar, Kotwali, Mirpur)', () => {
        const mirpurs = allUnits().filter(unit => unit.en === 'Mirpur');
        expect(mirpurs.map(unit => (unit.kind === 'thana' ? unit.districtId : ''))).toEqual([DHAKA, KUSHTIA]);
        const kotwalis = allUnits().filter(unit => unit.en === 'Kotwali');
        expect(kotwalis).toHaveLength(2);
        const sadars = allUnits().filter(unit => unit.en.endsWith(' Sadar'));
        expect(sadars.length).toBeGreaterThan(50);
    });

    it('names units in either language and sorts by that language', () => {
        const dhaka = findDistrict(DHAKA)!;
        expect(nameOf(dhaka, 'bn')).toBe('ঢাকা');
        expect(nameOf(dhaka, 'en')).toBe('Dhaka');
        const sylhet = getDistricts('BD60');
        expect(sortByName(sylhet, 'en')[0]!.en).toBe('Habiganj');
        expect(sortByName(sylhet, 'bn').map(unit => unit.bn)).toEqual([
            'মৌলভীবাজার',
            'সিলেট',
            'সুনামগঞ্জ',
            'হবিগঞ্জ',
        ]);
    });
});

describe('zoneOf', () => {
    it.each([
        [DHAKA, 'Mirpur', 'dhaka_city'],
        [DHAKA, 'Uttara East', 'dhaka_city'],
        [DHAKA, 'Dhanmondi', 'dhaka_city'],
        [DHAKA, 'Savar', 'dhaka_suburb'],
        [DHAKA, 'Keraniganj', 'dhaka_suburb'],
        [DHAKA, 'Dohar', 'dhaka_suburb'],
        [CHATTOGRAM, 'Panchlaish', 'chattogram_city'],
        [CHATTOGRAM, 'Patiya', 'outside_dhaka'],
        ['BD3033', 'Gazipur Sadar', 'outside_dhaka'],
        ['BD3067', 'Narayanganj Sadar', 'outside_dhaka'],
        ['BD6091', 'Sylhet City Corporation', 'outside_dhaka'],
        [KUSHTIA, 'Mirpur', 'outside_dhaka'],
    ])('%s / %s is %s', (districtId, thana, zone) => {
        expect(zoneOf(districtId, thanaNamed(districtId, thana).id)).toBe(zone);
    });

    it('uses the district when there is no thana, except in Dhaka where city and suburb differ', () => {
        expect(zoneOf(CHATTOGRAM)).toBe('outside_dhaka');
        expect(zoneOf('BD5010', OTHER_THANA_ID)).toBe('outside_dhaka');
        expect(zoneOf(DHAKA)).toBeUndefined();
        expect(zoneOf(DHAKA, OTHER_THANA_ID)).toBeUndefined();
    });

    it('returns undefined for unknown districts and thanas from another district', () => {
        expect(zoneOf('nowhere')).toBeUndefined();
        expect(zoneOf(KUSHTIA, thanaNamed(DHAKA, 'Mirpur').id)).toBeUndefined();
        expect(zoneOf(DHAKA, 'BD3026M99')).toBeUndefined();
    });
});

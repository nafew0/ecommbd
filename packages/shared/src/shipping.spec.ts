import { describe, expect, it } from 'vitest';
import { takaToMinor } from './money';
import {
    codFee,
    defaultShippingSettings,
    type DeliveryLine,
    type DeliveryQuoteInput,
    freeDeliveryRemaining,
    parseShippingSettings,
    quoteDelivery,
    type ShippingSettings,
} from './shipping';

const tk = takaToMinor;

const line = (patch: Partial<DeliveryLine> = {}): DeliveryLine => ({
    quantity: 1,
    weightGrams: null,
    freeDelivery: false,
    insideDhaka: null,
    outsideDhaka: null,
    surcharge: 0,
    ...patch,
});

const quote = (settings: ShippingSettings, input: Partial<DeliveryQuoteInput> = {}) =>
    quoteDelivery(settings, {
        method: 'standard',
        zone: 'dhaka_city',
        districtId: 'BD3026',
        thanaId: 'BD3026M26',
        subTotal: tk(1000),
        lines: [line()],
        ...input,
    });

const price = (settings: ShippingSettings, input: Partial<DeliveryQuoteInput> = {}) => {
    const result = quote(settings, input);
    return result.ok ? result.price : result.reason;
};

describe('shipping settings', () => {
    it('has defaults that pass the schema', () => {
        const settings = defaultShippingSettings();
        expect(parseShippingSettings(settings)).toEqual({ ok: true, settings });
    });

    it('refuses fractional taka, negative and huge amounts, as field errors', () => {
        const settings = defaultShippingSettings();
        const rates = (dhaka_city: number) => ({
            ...settings,
            standard: { ...settings.standard, rates: { ...settings.standard.rates, dhaka_city } },
        });
        for (const bad of [6050, -100, tk(20_000)]) {
            expect(parseShippingSettings(rates(bad))).toEqual({
                ok: false,
                errors: [{ path: 'standard.rates.dhaka_city', code: 'invalid' }],
            });
        }
    });

    it('refuses a duplicate override and an empty coverage', () => {
        const settings = defaultShippingSettings();
        const twice = { kind: 'district' as const, id: 'BD5081', rate: tk(150) };
        expect(parseShippingSettings({ ...settings, overrides: [twice, twice] })).toEqual({
            ok: false,
            errors: [{ path: 'overrides.1.id', code: 'invalid' }],
        });
        expect(parseShippingSettings({ ...settings, coverage: { ...settings.coverage, zones: [] } })).toEqual({
            ok: false,
            errors: [{ path: 'coverage.zones', code: 'required' }],
        });
    });
});

describe('quoteDelivery: standard', () => {
    const settings = defaultShippingSettings();

    it.each([
        ['dhaka_city', 60],
        ['dhaka_suburb', 100],
        ['outside_dhaka', 120],
        ['chattogram_city', 120],
    ] as const)('charges the default rate in %s: ৳%d', (zone, taka) => {
        expect(price(settings, { zone })).toBe(tk(taka));
    });

    it('gives Chattogram city its own rate only when the merchant turns that on', () => {
        const own: ShippingSettings = {
            ...settings,
            standard: {
                chattogramCityRate: true,
                rates: { ...settings.standard.rates, chattogram_city: tk(90) },
            },
        };
        expect(price(own, { zone: 'chattogram_city' })).toBe(tk(90));
    });

    it('uses the zone rate for an empty cart and for an address without a district ID', () => {
        expect(price(settings, { lines: [] })).toBe(tk(60));
        expect(price(settings, { zone: 'outside_dhaka', districtId: undefined, thanaId: undefined })).toBe(tk(120));
    });

    it('has no charge without a usable district', () => {
        expect(quote(settings, { zone: undefined })).toEqual({ ok: false, reason: 'NO_DISTRICT' });
    });

    it('uses a thana override before a district override before the zone rate', () => {
        const overridden: ShippingSettings = {
            ...settings,
            overrides: [
                { kind: 'district', id: 'BD5081', rate: tk(150) },
                { kind: 'thana', id: 'BD50810072', rate: tk(130) },
            ],
        };
        const rajshahi = { zone: 'outside_dhaka' as const, districtId: 'BD5081' };
        expect(price(overridden, { ...rajshahi, thanaId: 'BD50810072' })).toBe(tk(130));
        expect(price(overridden, { ...rajshahi, thanaId: 'BD50810001' })).toBe(tk(150));
        expect(price(overridden, { zone: 'outside_dhaka', districtId: 'BD4050' })).toBe(tk(120));
    });

    it('takes the highest product charge in the cart; free products count as 0', () => {
        const own = line({ insideDhaka: tk(80), outsideDhaka: tk(150) });
        expect(price(settings, { lines: [line(), own] })).toBe(tk(80));
        expect(price(settings, { zone: 'outside_dhaka', lines: [line(), own] })).toBe(tk(150));
        // Inside Dhaka means Dhaka city: the suburbs pay the product's outside-Dhaka charge.
        expect(price(settings, { zone: 'dhaka_suburb', lines: [own] })).toBe(tk(150));
        expect(price(settings, { lines: [line({ freeDelivery: true }), line()] })).toBe(tk(60));
        expect(price(settings, { lines: [line({ insideDhaka: tk(30) })] })).toBe(tk(30));
    });

    it('is free when every product delivers free', () => {
        expect(quote(settings, { lines: [line({ freeDelivery: true, surcharge: tk(50) })] })).toMatchObject({
            ok: true,
            price: 0,
            free: true,
        });
    });

    it('adds the weight surcharge for every started kilogram above the included weight', () => {
        const weighed: ShippingSettings = {
            ...settings,
            weight: { enabled: true, includedGrams: 1000, perKg: tk(20) },
        };
        const heavy = (grams: number, quantity = 1) => [line({ weightGrams: grams, quantity })];
        expect(price(weighed, { lines: heavy(1000) })).toBe(tk(60));
        expect(price(weighed, { lines: heavy(1001) })).toBe(tk(80));
        expect(price(weighed, { lines: heavy(1500, 2) })).toBe(tk(100));
        // Variants without a weight count as 0 g.
        expect(price(weighed, { lines: [line(), line()] })).toBe(tk(60));
        // Off: weight doesn't matter.
        expect(price(settings, { lines: heavy(9000) })).toBe(tk(60));
    });

    it('adds product surcharges per unit', () => {
        expect(price(settings, { lines: [line({ surcharge: tk(25), quantity: 2 }), line()] })).toBe(tk(110));
    });

    it('is free from the zone threshold (inclusive), surcharges included', () => {
        const free: ShippingSettings = {
            ...settings,
            freeAbove: { ...settings.freeAbove, dhaka_city: tk(2000) },
            weight: { enabled: true, includedGrams: 0, perKg: tk(20) },
        };
        const heavy = [line({ weightGrams: 3000 })];
        expect(price(free, { subTotal: tk(1999), lines: heavy })).toBe(tk(120));
        expect(price(free, { subTotal: tk(2000), lines: heavy })).toBe(0);
        // Other zones have no threshold.
        expect(price(free, { zone: 'outside_dhaka', subTotal: tk(5000), lines: heavy })).toBe(tk(180));
    });

    it('respects coverage: zones, districts and the weight limit', () => {
        const insideOnly: ShippingSettings = {
            ...settings,
            coverage: { zones: ['dhaka_city'], districtIds: [], maxWeightGrams: 5000 },
        };
        expect(quote(insideOnly, { zone: 'outside_dhaka' })).toEqual({ ok: false, reason: 'NOT_DELIVERED_HERE' });
        expect(quote(insideOnly, { lines: [line({ weightGrams: 5001 })] })).toEqual({
            ok: false,
            reason: 'TOO_HEAVY',
        });
        expect(price(insideOnly, { lines: [line({ weightGrams: 5000 })] })).toBe(tk(60));
        const someDistricts: ShippingSettings = {
            ...settings,
            coverage: { ...settings.coverage, districtIds: ['BD3026'] },
        };
        expect(price(someDistricts)).toBe(tk(60));
        expect(quote(someDistricts, { districtId: undefined })).toEqual({ ok: false, reason: 'NOT_DELIVERED_HERE' });
        expect(quote(someDistricts, { zone: 'outside_dhaka', districtId: 'BD5081' })).toEqual({
            ok: false,
            reason: 'NOT_DELIVERED_HERE',
        });
    });
});

describe('quoteDelivery: express and pickup', () => {
    const settings: ShippingSettings = {
        ...defaultShippingSettings(),
        express: {
            enabled: true,
            rates: { dhaka_city: tk(120), dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
        },
        pickup: { enabled: true },
        freeAbove: { dhaka_city: tk(500), dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
    };

    it('is off unless the merchant turns it on', () => {
        const off = defaultShippingSettings();
        expect(quote(off, { method: 'express' })).toEqual({ ok: false, reason: 'METHOD_OFF' });
        expect(quote(off, { method: 'pickup' })).toEqual({ ok: false, reason: 'METHOD_OFF' });
    });

    it('charges express its own rate, only where it has one, and never free', () => {
        expect(price(settings, { method: 'express', subTotal: tk(5000) })).toBe(tk(120));
        expect(quote(settings, { method: 'express', zone: 'outside_dhaka' })).toEqual({
            ok: false,
            reason: 'NOT_DELIVERED_HERE',
        });
    });

    it('makes store pickup free, with or without an address', () => {
        expect(price(settings, { method: 'pickup', zone: undefined })).toBe(0);
    });
});

describe('freeDeliveryRemaining', () => {
    const settings: ShippingSettings = {
        ...defaultShippingSettings(),
        freeAbove: { dhaka_city: tk(2000), dhaka_suburb: null, chattogram_city: null, outside_dhaka: tk(3000) },
    };

    it('says how much more to spend', () => {
        expect(freeDeliveryRemaining(settings, 'dhaka_city', tk(1500))).toEqual({
            threshold: tk(2000),
            remaining: tk(500),
        });
        expect(freeDeliveryRemaining(settings, 'dhaka_city', tk(2500))?.remaining).toBe(0);
        // Chattogram city uses the outside-Dhaka threshold by default.
        expect(freeDeliveryRemaining(settings, 'chattogram_city', 0)?.threshold).toBe(tk(3000));
        expect(freeDeliveryRemaining(settings, 'dhaka_suburb', 0)).toBeNull();
        expect(freeDeliveryRemaining(settings, undefined, 0)).toBeNull();
    });
});

describe('codFee', () => {
    const settings = defaultShippingSettings();

    it('is 0 when off', () => {
        expect(codFee(settings, tk(1000))).toBe(0);
    });

    it('is a flat fee, or a percentage rounded to whole taka', () => {
        const on = (patch: Partial<ShippingSettings['codFee']>): ShippingSettings => ({
            ...settings,
            codFee: { ...settings.codFee, enabled: true, ...patch },
        });
        expect(codFee(on({ type: 'flat', flat: tk(10) }), tk(1000))).toBe(tk(10));
        expect(codFee(on({ type: 'percent', percent: 1 }), tk(1350))).toBe(tk(14));
        expect(codFee(on({ type: 'percent', percent: 1 }), tk(1349))).toBe(tk(13));
        expect(codFee(on({ type: 'flat', flat: tk(10) }), 0)).toBe(0);
    });
});

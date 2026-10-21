import { describe, expect, it } from 'vitest';
import { takaToMinor } from './money';
import {
    advanceAmount,
    codRefusal,
    defaultPaymentSettings,
    enabledMfsProviders,
    lookalikeCharacters,
    mfsReference,
    normalizeTransactionId,
    parsePaymentSettings,
    type PaymentOrderFacts,
    type PaymentSettings,
} from './payments';

const tk = takaToMinor;

const order = (patch: Partial<PaymentOrderFacts> = {}): PaymentOrderFacts => ({
    total: tk(1370),
    delivery: tk(120),
    zone: 'outside_dhaka',
    productIds: ['1'],
    collectionIds: ['10'],
    risky: false,
    ...patch,
});

const withAdvance = (patch: Partial<PaymentSettings['advance']>): PaymentSettings => {
    const settings = defaultPaymentSettings();
    return { ...settings, advance: { ...settings.advance, enabled: true, ...patch } };
};

describe('payment settings', () => {
    it('has defaults that pass the schema: COD on, mobile banking off', () => {
        const settings = defaultPaymentSettings();
        expect(parsePaymentSettings(settings)).toEqual({ ok: true, settings });
        expect(enabledMfsProviders(settings)).toEqual([]);
    });

    it('needs a mobile number to turn a provider on, and normalizes it', () => {
        const settings = defaultPaymentSettings();
        const bkash = (number: string) => ({
            ...settings,
            mfs: { ...settings.mfs, bkash: { enabled: true, number, accountType: 'personal' } },
        });
        expect(parsePaymentSettings(bkash(''))).toEqual({
            ok: false,
            errors: [{ path: 'mfs.bkash.number', code: 'required' }],
        });
        expect(parsePaymentSettings(bkash('02-9876543'))).toEqual({
            ok: false,
            errors: [{ path: 'mfs.bkash.number', code: 'invalidMobile' }],
        });
        const parsed = parsePaymentSettings(bkash('০১৭১২-৩৪৫৬৭৮'));
        expect(parsed.ok && parsed.settings.mfs.bkash.number).toBe('+8801712345678');
        expect(parsed.ok && enabledMfsProviders(parsed.settings)).toEqual(['bkash']);
    });

    it('refuses fractional taka and bad percentages', () => {
        expect(parsePaymentSettings(withAdvance({ fixed: 150_50 })).ok).toBe(false);
        expect(parsePaymentSettings(withAdvance({ percent: 0 })).ok).toBe(false);
        expect(parsePaymentSettings(withAdvance({ percent: 101 })).ok).toBe(false);
    });
});

describe('codRefusal', () => {
    const settings = defaultPaymentSettings();

    it('allows COD by default', () => {
        expect(codRefusal(settings, order())).toBeNull();
    });

    it('refuses when off, over the limit, or outside the allowed zones', () => {
        expect(codRefusal({ ...settings, cod: { ...settings.cod, enabled: false } }, order())).toBe(
            'COD_OFF',
        );
        const limited = { ...settings, cod: { ...settings.cod, maxOrderTotal: tk(1000) } };
        expect(codRefusal(limited, order())).toBe('COD_OVER_LIMIT');
        expect(codRefusal(limited, order({ total: tk(1000) }))).toBeNull();
        const dhakaOnly = { ...settings, cod: { ...settings.cod, zones: ['dhaka_city' as const] } };
        expect(codRefusal(dhakaOnly, order())).toBe('COD_NOT_HERE');
        expect(codRefusal(dhakaOnly, order({ zone: undefined }))).toBe('COD_NOT_HERE');
        expect(codRefusal(dhakaOnly, order({ zone: 'dhaka_city' }))).toBeNull();
    });
});

describe('advanceAmount', () => {
    it('is 0 when off', () => {
        expect(advanceAmount(defaultPaymentSettings(), order())).toBe(0);
    });

    it.each([
        ['delivery', {}, tk(120)],
        ['fixed', { fixed: tk(200) }, tk(200)],
        ['percent', { percent: 10 }, tk(137)],
        // 7.5% of ৳1,370 is ৳102.75: whole taka.
        ['percent', { percent: 7.5 }, tk(103)],
    ] as const)('applies the %s rule', (rule, patch, expected) => {
        expect(advanceAmount(withAdvance({ rule, ...patch }), order())).toBe(expected);
    });

    it('never asks more than the total', () => {
        expect(advanceAmount(withAdvance({ rule: 'fixed', fixed: tk(5000) }), order())).toBe(tk(1370));
        expect(advanceAmount(withAdvance({ rule: 'percent', percent: 100 }), order())).toBe(tk(1370));
    });

    it('applies only in its scope', () => {
        const outside = withAdvance({ scope: 'outsideDhaka' });
        expect(advanceAmount(outside, order())).toBe(tk(120));
        expect(advanceAmount(outside, order({ zone: 'dhaka_city' }))).toBe(0);
        expect(advanceAmount(outside, order({ zone: 'dhaka_suburb' }))).toBe(0);
        expect(advanceAmount(outside, order({ zone: 'chattogram_city' }))).toBe(tk(120));

        const products = withAdvance({ scope: 'products', productIds: ['2'], collectionIds: ['10'] });
        expect(advanceAmount(products, order())).toBe(tk(120));
        expect(advanceAmount(products, order({ collectionIds: [] }))).toBe(0);
        expect(advanceAmount(products, order({ productIds: ['2'], collectionIds: [] }))).toBe(tk(120));

        const risky = withAdvance({ scope: 'risky' });
        expect(advanceAmount(risky, order())).toBe(0);
        expect(advanceAmount(risky, order({ risky: true }))).toBe(tk(120));
    });

    it('is 0 for free delivery with the delivery rule', () => {
        expect(advanceAmount(withAdvance({ rule: 'delivery' }), order({ delivery: 0 }))).toBe(0);
    });
});

describe('transaction IDs', () => {
    it.each([
        ['8n7a6d5e4f', '8N7A6D5E4F'],
        [' 8N7A 6D5E-4F ', '8N7A6D5E4F'],
        ['৮১২৩৪৫৬৭৮৯', '8123456789'],
        ['ABCD1234', 'ABCD1234'],
    ])('reads %j as %j', (input, expected) => {
        expect(normalizeTransactionId(input)).toBe(expected);
    });

    it.each([[''], ['ABC123'], ['ABCDEFGHIJKLM'], ['8N7A6D5E4F!']])('refuses %j', input => {
        expect(normalizeTransactionId(input)).toBeNull();
    });

    it('keys a transaction by provider', () => {
        expect(mfsReference('bkash', '8N7A6D5E4F')).toBe('bkash:8N7A6D5E4F');
    });

    it('points out characters that are easy to misread, without changing them', () => {
        expect(lookalikeCharacters('8N7A6D5E4F')).toEqual(['8', '5']);
        expect(lookalikeCharacters('ACDEFGHJK')).toEqual([]);
        expect(lookalikeCharacters('O0I1')).toEqual(['O', '0', 'I', '1']);
    });
});

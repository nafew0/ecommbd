import { describe, expect, it } from 'vitest';
import {
    CHECKOUT_LIMITS,
    defaultCheckoutSettings,
    parseCheckoutEmail,
    parseCheckoutName,
    parseCheckoutPhone,
    parseCheckoutSettings,
    textLength,
} from './checkout';

describe('parseCheckoutPhone', () => {
    it.each([['01712345678'], ['০১৭১২-৩৪৫৬৭৮'], ['+880 1712-345678'], ['8801712345678'], [' 01712 345678 ']])(
        'accepts the Bangladeshi mobile %s as E.164',
        input => {
            expect(parseCheckoutPhone(input)).toEqual({ ok: true, e164: '+8801712345678', bdMobile: true });
        },
    );

    it('rejects a landline with NOT_A_MOBILE, even when foreign numbers are allowed', () => {
        expect(parseCheckoutPhone('02-9123456')).toEqual({ ok: false, code: 'NOT_A_MOBILE' });
        expect(parseCheckoutPhone('02-9123456', { allowInternational: true })).toEqual({
            ok: false,
            code: 'NOT_A_MOBILE',
        });
    });

    it.each([[''], ['   '], ['hello'], ['01212345678'], ['12345']])(
        'rejects %j with INVALID_PHONE',
        input => {
            expect(parseCheckoutPhone(input)).toEqual({ ok: false, code: 'INVALID_PHONE' });
        },
    );

    it('rejects a foreign number unless the store allows them', () => {
        expect(parseCheckoutPhone('+44 7911 123456')).toEqual({ ok: false, code: 'INVALID_PHONE' });
        expect(parseCheckoutPhone('+44 7911 123456', { allowInternational: true })).toEqual({
            ok: true,
            e164: '+447911123456',
            bdMobile: false,
        });
        expect(parseCheckoutPhone('00971 50 123 4567', { allowInternational: true })).toEqual({
            ok: true,
            e164: '+971501234567',
            bdMobile: false,
        });
    });

    it('needs + or 00 for a foreign number, and never treats a broken +880 number as foreign', () => {
        expect(parseCheckoutPhone('447911123456', { allowInternational: true })).toEqual({
            ok: false,
            code: 'INVALID_PHONE',
        });
        expect(parseCheckoutPhone('+880 1212 345678', { allowInternational: true })).toEqual({
            ok: false,
            code: 'INVALID_PHONE',
        });
    });
});

describe('parseCheckoutName', () => {
    it.each([
        ['রহিম উদ্দিন', 'রহিম উদ্দিন'],
        ['  Rahim   Uddin ', 'Rahim Uddin'],
        ['Rahim', 'Rahim'],
        ['মিম 🌸', 'মিম 🌸'],
    ])('accepts %j', (input, name) => {
        expect(parseCheckoutName(input)).toEqual({ ok: true, name });
    });

    it('rejects a blank name', () => {
        expect(parseCheckoutName('   ')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
        expect(parseCheckoutName('​')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    });

    it('allows 100 characters, counting emoji as one, and rejects more', () => {
        expect(parseCheckoutName('🌸'.repeat(100))).toMatchObject({ ok: true });
        expect(parseCheckoutName('a'.repeat(101))).toEqual({ ok: false, code: 'NAME_TOO_LONG' });
    });
});

describe('parseCheckoutEmail', () => {
    it('lowercases a real email and treats blank as none', () => {
        expect(parseCheckoutEmail(' Rahim@Example.COM ')).toEqual({ ok: true, email: 'rahim@example.com' });
        expect(parseCheckoutEmail('')).toEqual({ ok: true, email: null });
        expect(parseCheckoutEmail(null)).toEqual({ ok: true, email: null });
        expect(parseCheckoutEmail(undefined)).toEqual({ ok: true, email: null });
    });

    it.each([['not-an-email'], ['8801712345678@phone.invalid'], [`${'a'.repeat(250)}@example.com`]])(
        'rejects %s',
        input => {
            expect(parseCheckoutEmail(input)).toEqual({ ok: false, code: 'INVALID_EMAIL' });
        },
    );
});

describe('textLength', () => {
    it('counts characters, not UTF-16 units', () => {
        expect(textLength('🌸🌸')).toBe(2);
        expect(textLength('ঢাকা')).toBe(4);
    });
});

describe('checkout settings', () => {
    it('has safe defaults that pass the schema', () => {
        const settings = defaultCheckoutSettings();
        expect(settings).toEqual({
            showEmail: false,
            showAlternatePhone: true,
            showNote: true,
            minAddressLength: 10,
            allowInternationalPhones: false,
        });
        expect(parseCheckoutSettings(settings)).toEqual({ ok: true, settings });
    });

    it('returns field errors as codes', () => {
        expect(
            parseCheckoutSettings({
                ...defaultCheckoutSettings(),
                minAddressLength: CHECKOUT_LIMITS.minAddressLengthMax + 1,
            }),
        ).toEqual({ ok: false, errors: [{ path: 'minAddressLength', code: 'invalid' }] });
        expect(parseCheckoutSettings({ ...defaultCheckoutSettings(), minAddressLength: 2.5 })).toEqual({
            ok: false,
            errors: [{ path: 'minAddressLength', code: 'invalid' }],
        });
        expect(parseCheckoutSettings({ ...defaultCheckoutSettings(), showNote: 'yes' })).toEqual({
            ok: false,
            errors: [{ path: 'showNote', code: 'invalid' }],
        });
    });
});

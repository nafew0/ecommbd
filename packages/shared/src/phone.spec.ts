import { describe, expect, it } from 'vitest';
import { findBdPhones, formatBdPhone, maskPhone, parseBdMobile, parseBdPhone } from './phone';

describe('parseBdMobile', () => {
    it.each([
        ['01712345678'],
        ['+8801712345678'],
        ['8801712345678'],
        ['008801712345678'],
        ['০১৭১২৩৪৫৬৭৮'],
        ['017-1234-5678'],
        ['(017) 12345678'],
        ['  01712345678  '],
        ['1712345678'],
        ['+880 1712-345678'],
        ['+88 01712345678'],
        ['+880 01712345678'],
        ['01712345678 (bkash)'],
        ['Call me on 01712345678 after 5pm'],
    ])('accepts %s', input => {
        const result = parseBdMobile(input);
        expect(result).toEqual({
            ok: true,
            phone: {
                kind: 'mobile',
                e164: '+8801712345678',
                national: '01712345678',
                operator: 'Grameenphone',
            },
            extras: [],
        });
    });

    it.each([
        ['01312345678', 'Grameenphone'],
        ['01712345678', 'Grameenphone'],
        ['01412345678', 'Banglalink'],
        ['01912345678', 'Banglalink'],
        ['01512345678', 'Teletalk'],
        ['01612345678', 'Robi'],
        ['01812345678', 'Robi'],
    ])('knows the operator of %s', (input, operator) => {
        const result = parseBdMobile(input);
        expect(result.ok && result.phone.operator).toBe(operator);
    });

    it('returns EMPTY for blank input', () => {
        expect(parseBdMobile('   ')).toEqual({ ok: false, code: 'EMPTY' });
    });

    it.each([['01212345678'], ['0171234567'], ['017123456789'], ['hello'], ['Order 2026-10-20'], ['123']])(
        'rejects %s as INVALID',
        input => {
            expect(parseBdMobile(input)).toEqual({ ok: false, code: 'INVALID' });
        },
    );

    it('rejects a landline with NOT_MOBILE', () => {
        expect(parseBdMobile('02-9123456')).toEqual({ ok: false, code: 'NOT_MOBILE' });
    });

    it('takes the first of two numbers and reports the second', () => {
        expect(parseBdMobile('01712345678/01812345678')).toMatchObject({
            ok: true,
            phone: { national: '01712345678' },
            extras: ['01812345678'],
        });
    });

    it('splits two numbers typed with only a space between them', () => {
        expect(parseBdMobile('01712345678 01812345678')).toMatchObject({
            ok: true,
            phone: { national: '01712345678' },
            extras: ['01812345678'],
        });
    });

    it('ignores numbers that are not phones around a real one', () => {
        expect(parseBdMobile('Order 2026-10-20 call 01712345678')).toMatchObject({
            ok: true,
            phone: { national: '01712345678' },
            extras: [],
        });
    });
});

describe('parseBdPhone', () => {
    it('accepts landlines as well as mobiles', () => {
        expect(parseBdPhone('02-9123456')).toEqual({
            ok: true,
            phone: { kind: 'landline', e164: '+88029123456', national: '029123456' },
            extras: [],
        });
        expect(parseBdPhone('01712345678')).toMatchObject({ ok: true, phone: { kind: 'mobile' } });
    });

    it('returns INVALID when nothing matches', () => {
        expect(parseBdPhone('abc')).toEqual({ ok: false, code: 'INVALID' });
    });
});

describe('findBdPhones', () => {
    it('finds every number in order', () => {
        expect(findBdPhones('01712345678, 02-9123456 or 01912345678').map(phone => phone.national)).toEqual([
            '01712345678',
            '029123456',
            '01912345678',
        ]);
    });
});

describe('formatBdPhone and maskPhone', () => {
    it('formats mobiles as 01XXX-XXXXXX', () => {
        expect(formatBdPhone('+8801712345678')).toBe('01712-345678');
        expect(formatBdPhone('01712345678')).toBe('01712-345678');
    });

    it('leaves landlines and unknown input in national form', () => {
        expect(formatBdPhone('+88029123456')).toBe('029123456');
        expect(formatBdPhone('abc')).toBe('');
    });

    it('masks all but the last 3 digits', () => {
        expect(maskPhone('+8801712345678')).toBe('01******678');
        expect(maskPhone('01712345678')).toBe('01******678');
        expect(maskPhone('987654')).toBe('98*654');
        expect(maskPhone('12345')).toBe('*****');
    });
});

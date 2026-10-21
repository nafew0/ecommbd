import { describe, expect, it } from 'vitest';
import { isPlaceholderEmail, placeholderEmailFor, visibleEmail } from './placeholder-email';

describe('placeholder emails', () => {
    it('makes one from the phone digits', () => {
        expect(placeholderEmailFor('+8801712345678')).toBe('8801712345678@phone.invalid');
        expect(placeholderEmailFor('+447911123456')).toBe('447911123456@phone.invalid');
        expect(() => placeholderEmailFor('')).toThrow(RangeError);
    });

    it.each([
        ['8801712345678@phone.invalid'],
        ['8801712345678@PHONE.INVALID'],
        ['Rahim <8801712345678@phone.invalid>'],
        ['someone@example.invalid'],
        ['someone@invalid'],
    ])('recognizes %s', email => {
        expect(isPlaceholderEmail(email)).toBe(true);
        expect(visibleEmail(email)).toBeNull();
    });

    it.each([['rahim@example.com'], ['Rahim <rahim@example.com>'], ['invalid@example.com']])(
        'leaves the real address %s alone',
        email => {
            expect(isPlaceholderEmail(email)).toBe(false);
            expect(visibleEmail(email)).toBe(email);
        },
    );

    it('treats a missing or malformed value as no email, not a placeholder', () => {
        for (const value of ['', null, undefined, 'phone.invalid']) {
            expect(isPlaceholderEmail(value)).toBe(false);
        }
        expect(visibleEmail('')).toBeNull();
        expect(visibleEmail(null)).toBeNull();
    });
});

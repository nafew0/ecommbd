import { describe, expect, it } from 'vitest';
import { errorMap, getIn, setIn } from './form';

describe('form helpers', () => {
    it('reads nested values by dotted path, including array items', () => {
        const value = { profile: { phones: ['017', '018'], name: { bn: 'ক' } } };
        expect(getIn(value, 'profile.name.bn')).toBe('ক');
        expect(getIn(value, 'profile.phones.1')).toBe('018');
        expect(getIn(value, 'profile.missing.deep')).toBeUndefined();
    });

    it('writes without changing the original, copying only along the path', () => {
        const original = { profile: { phones: ['017'], name: { bn: 'ক' } }, locale: { a: 1 } };
        const next = setIn(original, 'profile.phones.0', '019');
        expect(next.profile.phones).toEqual(['019']);
        expect(original.profile.phones).toEqual(['017']);
        expect(next.locale).toBe(original.locale);
        expect(Array.isArray(next.profile.phones)).toBe(true);
        expect(setIn({}, 'a.b', 1)).toEqual({ a: { b: 1 } });
    });

    it('keeps the first error per field', () => {
        expect(
            errorMap([
                { path: 'profile.email', code: 'invalidEmail' },
                { path: 'profile.email', code: 'tooLong' },
            ]),
        ).toEqual({ 'profile.email': 'invalidEmail' });
    });
});

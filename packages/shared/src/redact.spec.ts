import { describe, expect, it } from 'vitest';
import { isSensitiveHeader, maskEmail, REDACTED, redactObject, redactText } from './redact';

describe('redactText', () => {
    it('masks emails and Bangladeshi phone numbers', () => {
        expect(redactText('Order by nafew@example.com, phone +880 1712-345678')).toBe(
            'Order by n***@example.com, phone 01******678',
        );
    });

    it('leaves other numbers alone', () => {
        expect(redactText('Order 20261020 total 125000')).toBe('Order 20261020 total 125000');
    });

    it('masks odd email shapes safely', () => {
        expect(maskEmail('bad')).toBe('***');
        expect(maskEmail('@example.com')).toBe('***');
    });
});

describe('redactObject', () => {
    it('hides sensitive keys and redacts strings deeply', () => {
        const input = {
            phone: '01712345678',
            password: 'hunter2',
            nested: { apiKey: 'k', items: ['a@b.com', 3, null], when: new Date('2026-10-20T00:00:00Z') },
            Authorization: 'Bearer x',
        };
        expect(redactObject(input)).toEqual({
            phone: '01******678',
            password: REDACTED,
            nested: { apiKey: REDACTED, items: ['a***@b.com', 3, null], when: '2026-10-20T00:00:00.000Z' },
            Authorization: REDACTED,
        });
    });

    it('cuts cycles but not repeated references', () => {
        const shared = { name: 'shared' };
        const cyclic: Record<string, unknown> = { a: shared, b: shared };
        cyclic.self = cyclic;
        expect(redactObject(cyclic)).toEqual({
            a: { name: 'shared' },
            b: { name: 'shared' },
            self: '[Circular]',
        });
    });

    it('truncates very deep nesting', () => {
        let deep: Record<string, unknown> = { leaf: true };
        for (let i = 0; i < 10; i += 1) {
            deep = { next: deep };
        }
        expect(JSON.stringify(redactObject(deep))).toContain('[Truncated]');
    });

    it('passes primitives through', () => {
        expect(redactObject(42)).toBe(42);
        expect(redactObject(undefined)).toBeUndefined();
    });

    it('knows which headers are sensitive', () => {
        expect(isSensitiveHeader('Authorization')).toBe(true);
        expect(isSensitiveHeader('x-api-key')).toBe(true);
        expect(isSensitiveHeader('content-type')).toBe(false);
    });
});

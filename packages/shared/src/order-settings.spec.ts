import { describe, expect, it } from 'vitest';
import {
    defaultOrderSettings,
    formatOrderNumber,
    normalizeOrderNumberSearch,
    parseOrderSettings,
    shouldSuggestCancel,
} from './order-settings';

const DAY = 24 * 60 * 60 * 1000;

describe('order settings', () => {
    it('has defaults that pass the schema, and normalizes the prefix', () => {
        const settings = defaultOrderSettings();
        expect(parseOrderSettings(settings)).toEqual({ ok: true, settings });
        const parsed = parseOrderSettings({ ...settings, orderNumberPrefix: ' mf ' });
        expect(parsed.ok && parsed.settings.orderNumberPrefix).toBe('MF');
    });

    it('returns field errors as codes', () => {
        const settings = defaultOrderSettings();
        expect(parseOrderSettings({ ...settings, orderNumberPrefix: 'TOO-LONG!' })).toEqual({
            ok: false,
            errors: [{ path: 'orderNumberPrefix', code: 'invalid' }],
        });
        expect(
            parseOrderSettings({ ...settings, autoCancel: { ...settings.autoCancel, afterDays: 0 } }),
        ).toEqual({
            ok: false,
            errors: [{ path: 'autoCancel.afterDays', code: 'invalid' }],
        });
    });
});

describe('order numbers', () => {
    it('formats with or without a prefix', () => {
        expect(formatOrderNumber('', 1001)).toBe('1001');
        expect(formatOrderNumber('MF', 1001)).toBe('MF-1001');
    });

    it.each([
        ['1001', '1001'],
        ['#1001', '1001'],
        ['১০০১', '1001'],
        [' mf-1001 ', 'MF-1001'],
        ['MF - 1001', 'MF-1001'],
    ])('reads %j as %j', (input, expected) => {
        expect(normalizeOrderNumberSearch(input)).toBe(expected);
    });

    it.each([['রহিম'], ['01712345678x'], ['TOOLONG-1'], ['']])('does not read %j as a number', input => {
        expect(normalizeOrderNumberSearch(input)).toBeNull();
    });
});

describe('shouldSuggestCancel', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    const old = { placedAt: new Date(now.getTime() - 4 * DAY), failedCalls: 3 };
    const on = { ...defaultOrderSettings().autoCancel, suggest: true };

    it('suggests only when switched on, old enough and called enough', () => {
        expect(shouldSuggestCancel(old, defaultOrderSettings().autoCancel, now)).toBe(false);
        expect(shouldSuggestCancel(old, on, now)).toBe(true);
        expect(shouldSuggestCancel({ ...old, failedCalls: 2 }, on, now)).toBe(false);
        expect(shouldSuggestCancel({ ...old, placedAt: new Date(now.getTime() - DAY) }, on, now)).toBe(false);
        expect(shouldSuggestCancel(old, { ...on, suggest: false, cancelAutomatically: true }, now)).toBe(
            true,
        );
    });

    it('uses the current time by default', () => {
        expect(shouldSuggestCancel({ placedAt: new Date(0), failedCalls: 5 }, on)).toBe(true);
    });
});

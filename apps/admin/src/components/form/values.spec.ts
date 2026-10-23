import { describe, expect, it } from 'vitest';
import {
    formatTakaInput,
    fromDhakaInputValue,
    parseTakaInput,
    takaInputText,
    toDhakaInputValue,
} from './values';

describe('parseTakaInput', () => {
    it('accepts Bangla and English digits, commas and the taka sign', () => {
        expect(parseTakaInput('১,২৫০')).toEqual({ ok: true, minor: 125000 });
        expect(parseTakaInput(' ৳ 1,00,000 ')).toEqual({ ok: true, minor: 10000000 });
        expect(parseTakaInput('Tk 60')).toEqual({ ok: true, minor: 6000 });
        expect(parseTakaInput('')).toEqual({ ok: true, minor: null });
    });

    it('rejects poisha and anything that is not a number', () => {
        expect(parseTakaInput('99.50')).toEqual({ ok: false, reason: 'fraction' });
        expect(parseTakaInput('abc')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('reads a price with the point the same as without: ৳990, never ৳99,000', () => {
        for (const typed of ['990', '990.00', '990.0', '990.', '৯৯০', '৯৯০.০০'])
            expect(parseTakaInput(typed), typed).toEqual({ ok: true, minor: 99_000 });
        expect(parseTakaInput('990.50')).toEqual({ ok: false, reason: 'fraction' });
        expect(parseTakaInput('৯৯০.৫০')).toEqual({ ok: false, reason: 'fraction' });
        expect(parseTakaInput('990..0')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('keeps what the merchant is typing while it means the same price', () => {
        // Typing "990.00" one key at a time: the point and zeros stay on screen.
        expect(takaInputText('990.', 99_000)).toBe('990.');
        expect(takaInputText('990.0', 99_000)).toBe('990.0');
        expect(takaInputText('৯৯০', 99_000)).toBe('৯৯০');
        // A new price from outside (saved settings, undo) replaces the text.
        expect(takaInputText('990.', 120_000)).toBe('1200');
        expect(takaInputText('990', null)).toBe('');
        expect(takaInputText('', 99_000)).toBe('990');
    });

    it('formats with lakh grouping, in either digits', () => {
        expect(formatTakaInput(10000000, false)).toBe('1,00,000');
        expect(formatTakaInput(125000, true)).toBe('১,২৫০');
        expect(formatTakaInput(null, false)).toBe('');
    });
});

describe('Dhaka date and time inputs', () => {
    it('shows UTC times in Dhaka time and reads them back', () => {
        // 23:59 in Dhaka is 17:59 UTC the same day.
        expect(toDhakaInputValue('2026-10-21T17:59:00.000Z')).toBe('2026-10-21T23:59');
        expect(fromDhakaInputValue('2026-10-21T23:59')).toBe('2026-10-21T17:59:00.000Z');
        // Midnight in Dhaka is still the previous day in UTC.
        expect(fromDhakaInputValue('2026-10-22T00:00')).toBe('2026-10-21T18:00:00.000Z');
        expect(toDhakaInputValue(null)).toBe('');
        expect(fromDhakaInputValue('')).toBeNull();
    });
});

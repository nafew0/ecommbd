import { describe, expect, it } from 'vitest';
import {
    dhakaDateKey,
    dhakaParts,
    endOfDhakaDay,
    formatDhaka,
    fromDhaka,
    isBdWeekend,
    isWithinQuietHours,
    nextAllowedSendTime,
    startOfDhakaDay,
} from './time';

// 2026-10-20 is a Tuesday; 2026-10-23 is a Friday.
const utc = (iso: string) => new Date(iso);

describe('Dhaka calendar', () => {
    it('reads wall-clock fields in Dhaka (UTC+6)', () => {
        expect(dhakaParts(utc('2026-10-20T17:59:59Z'))).toEqual({
            year: 2026,
            month: 10,
            day: 20,
            hour: 23,
            minute: 59,
            second: 59,
            weekday: 2,
        });
    });

    it('puts 23:59 and 00:00 Dhaka on different days although both are 20 October in UTC', () => {
        expect(dhakaDateKey(utc('2026-10-20T17:59:59Z'))).toBe('2026-10-20');
        expect(dhakaDateKey(utc('2026-10-20T18:00:00Z'))).toBe('2026-10-21');
    });

    it('finds the start and end of the Dhaka day', () => {
        expect(startOfDhakaDay(utc('2026-10-20T19:00:00Z')).toISOString()).toBe('2026-10-20T18:00:00.000Z');
        expect(endOfDhakaDay(utc('2026-10-20T19:00:00Z')).toISOString()).toBe('2026-10-21T18:00:00.000Z');
        expect(fromDhaka(2026, 10, 21, 8).toISOString()).toBe('2026-10-21T02:00:00.000Z');
        expect(fromDhaka(2026, 10, 21).toISOString()).toBe('2026-10-20T18:00:00.000Z');
    });

    it('rejects invalid dates', () => {
        expect(() => dhakaParts(new Date('nope'))).toThrow(RangeError);
        expect(() => startOfDhakaDay(new Date('nope'))).toThrow(RangeError);
    });
});

describe('quiet hours', () => {
    const at = (hour: number, minute = 0) => fromDhaka(2026, 10, 20, hour, minute);

    it('handles a window crossing midnight', () => {
        expect(isWithinQuietHours(at(23), 22, 8)).toBe(true);
        expect(isWithinQuietHours(at(7, 59), 22, 8)).toBe(true);
        expect(isWithinQuietHours(at(8), 22, 8)).toBe(false);
        expect(isWithinQuietHours(at(21, 59), 22, 8)).toBe(false);
    });

    it('handles a window within one day, and no window', () => {
        expect(isWithinQuietHours(at(2), 1, 5)).toBe(true);
        expect(isWithinQuietHours(at(6), 1, 5)).toBe(false);
        expect(isWithinQuietHours(at(0, 30), 1, 5)).toBe(false);
        expect(isWithinQuietHours(at(3), 22, 22)).toBe(false);
    });

    it('rejects impossible hours', () => {
        expect(() => isWithinQuietHours(at(1), 24, 8)).toThrow(RangeError);
        expect(() => isWithinQuietHours(at(1), 22, -1)).toThrow(RangeError);
        expect(() => isWithinQuietHours(at(1), 1.5, 8)).toThrow(RangeError);
    });

    it('moves a message to the end of quiet hours', () => {
        const morning = fromDhaka(2026, 10, 20, 12);
        expect(nextAllowedSendTime(morning, 22, 8)).toBe(morning);
        expect(nextAllowedSendTime(at(23), 22, 8).toISOString()).toBe(
            fromDhaka(2026, 10, 21, 8).toISOString(),
        );
        expect(nextAllowedSendTime(at(2), 22, 8).toISOString()).toBe(
            fromDhaka(2026, 10, 20, 8).toISOString(),
        );
        expect(nextAllowedSendTime(at(2), 1, 5).toISOString()).toBe(fromDhaka(2026, 10, 20, 5).toISOString());
    });
});

describe('weekends and formatting', () => {
    it('treats Friday in Dhaka as the weekend by default', () => {
        expect(isBdWeekend(fromDhaka(2026, 10, 23, 12))).toBe(true);
        // Thursday 23:00 UTC is already Friday 05:00 in Dhaka.
        expect(isBdWeekend(utc('2026-10-22T23:00:00Z'))).toBe(true);
        expect(isBdWeekend(fromDhaka(2026, 10, 24, 12))).toBe(false);
        expect(isBdWeekend(fromDhaka(2026, 10, 24, 12), [5, 6])).toBe(true);
    });

    it('formats dates the Bangladeshi way', () => {
        const date = utc('2026-10-20T17:59:00Z');
        expect(formatDhaka(date)).toBe('20/10/2026');
        expect(formatDhaka(date, { withTime: true })).toBe('20/10/2026 23:59');
        expect(formatDhaka(date, { banglaDigits: true })).toBe('২০/১০/২০২৬');
    });
});

import { asciiToBanglaDigits } from './text';

/**
 * Dhaka time. Everything is stored in UTC and shown or calculated in Asia/Dhaka.
 *
 * Bangladesh has used a fixed UTC+6 offset with no daylight saving since 2009, so a constant
 * offset is exact for every date we handle.
 */

export const DHAKA_TIME_ZONE = 'Asia/Dhaka';
const OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DhakaParts {
    year: number;
    /** 1–12 */
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    /** 0 = Sunday … 5 = Friday, 6 = Saturday */
    weekday: number;
}

function assertDate(date: Date): void {
    if (Number.isNaN(date.getTime())) {
        throw new RangeError('Invalid date');
    }
}

/** The calendar fields of an instant, as seen in Dhaka. */
export function dhakaParts(date: Date): DhakaParts {
    assertDate(date);
    const shifted = new Date(date.getTime() + OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
        weekday: shifted.getUTCDay(),
    };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The Dhaka calendar day as `YYYY-MM-DD`, for grouping reports and "today". */
export function dhakaDateKey(date: Date): string {
    const { year, month, day } = dhakaParts(date);
    return `${year}-${pad(month)}-${pad(day)}`;
}

/** The UTC instant at 00:00 Dhaka time on the Dhaka day containing `date`. */
export function startOfDhakaDay(date: Date): Date {
    assertDate(date);
    const shifted = date.getTime() + OFFSET_MS;
    return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - OFFSET_MS);
}

/** The UTC instant at 00:00 Dhaka time on the following day (exclusive end of the day). */
export function endOfDhakaDay(date: Date): Date {
    return new Date(startOfDhakaDay(date).getTime() + DAY_MS);
}

/** The UTC instant for a Dhaka wall-clock time. */
export function fromDhaka(year: number, month: number, day: number, hour = 0, minute = 0): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

function assertHour(hour: number): void {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new RangeError(`Hour must be 0–23, got ${hour}`);
    }
}

/**
 * True when `date` falls in quiet hours [startHour, endHour) in Dhaka.
 * The window may cross midnight (22 → 8). Equal start and end means no quiet hours.
 */
export function isWithinQuietHours(date: Date, startHour: number, endHour: number): boolean {
    assertHour(startHour);
    assertHour(endHour);
    const { hour } = dhakaParts(date);
    if (startHour === endHour) {
        return false;
    }
    if (startHour < endHour) {
        return hour >= startHour && hour < endHour;
    }
    return hour >= startHour || hour < endHour;
}

/** `date` itself if outside quiet hours, otherwise the moment quiet hours end. */
export function nextAllowedSendTime(date: Date, startHour: number, endHour: number): Date {
    if (!isWithinQuietHours(date, startHour, endHour)) {
        return date;
    }
    const { year, month, day, hour } = dhakaParts(date);
    const endToday = fromDhaka(year, month, day, endHour);
    // Crossing midnight and still before midnight: quiet hours end tomorrow morning.
    return startHour > endHour && hour >= startHour ? new Date(endToday.getTime() + DAY_MS) : endToday;
}

/** True on Friday (and on any other days passed in) in Dhaka. */
export function isBdWeekend(date: Date, weekendDays: readonly number[] = [5]): boolean {
    return weekendDays.includes(dhakaParts(date).weekday);
}

export interface FormatDhakaOptions {
    banglaDigits?: boolean;
    /** Include `HH:mm` (24-hour). Default false. */
    withTime?: boolean;
}

/** Formats as `20/10/2026` or `20/10/2026 23:59`, the way Bangladeshi merchants write dates. */
export function formatDhaka(date: Date, options: FormatDhakaOptions = {}): string {
    const { year, month, day, hour, minute } = dhakaParts(date);
    let text = `${pad(day)}/${pad(month)}/${year}`;
    if (options.withTime) {
        text += ` ${pad(hour)}:${pad(minute)}`;
    }
    return options.banglaDigits ? asciiToBanglaDigits(text) : text;
}

import { asciiToBanglaDigits } from './text';

/**
 * Money in Bangladeshi taka.
 *
 * Amounts are integers in minor units (poisha, 1 taka = 100 poisha), as Vendure stores them.
 * Prices, delivery charges and discounts are whole taka, so totals and COD amounts are too
 * (couriers require whole-taka COD amounts). Percentages round half away from zero to the
 * nearest taka. See docs/roadmap/README.md, "Money, time, phone numbers and text".
 */

const MINOR_PER_TAKA = 100;

function assertMinor(minor: number): void {
    if (!Number.isSafeInteger(minor)) {
        throw new RangeError(`Money amounts must be whole numbers of poisha, got ${minor}`);
    }
}

/** Rounds half away from zero: 2.5 → 3, -2.5 → -3. */
function roundHalfAwayFromZero(value: number): number {
    // Remove floating-point noise first, so 1.0049999999 isn't mistaken for 1.005.
    const cleaned = Math.round(value * 1e6) / 1e6;
    return Math.sign(cleaned) * Math.round(Math.abs(cleaned));
}

/** Converts taka (possibly fractional, e.g. 1350 or 99.5) to minor units. */
export function takaToMinor(taka: number): number {
    if (!Number.isFinite(taka)) {
        throw new RangeError(`Invalid taka amount: ${taka}`);
    }
    return roundHalfAwayFromZero(taka * MINOR_PER_TAKA);
}

/** Converts minor units to taka as a number (may be fractional). */
export function minorToTaka(minor: number): number {
    assertMinor(minor);
    return minor / MINOR_PER_TAKA;
}

/** True when the amount is a whole number of taka. */
export function isWholeTaka(minor: number): boolean {
    assertMinor(minor);
    return minor % MINOR_PER_TAKA === 0;
}

/** Rounds an amount in minor units to the nearest whole taka (half away from zero). */
export function roundToWholeTaka(minor: number): number {
    if (!Number.isFinite(minor)) {
        throw new RangeError(`Invalid amount: ${minor}`);
    }
    return roundHalfAwayFromZero(minor / MINOR_PER_TAKA) * MINOR_PER_TAKA;
}

/** A percentage of an amount, rounded to whole taka: 7.5% of ৳1,350 → ৳101. */
export function percentOfWholeTaka(minor: number, percent: number): number {
    assertMinor(minor);
    if (!Number.isFinite(percent)) {
        throw new RangeError(`Invalid percentage: ${percent}`);
    }
    return roundToWholeTaka((minor * percent) / 100);
}

/** Groups digits the Bangladeshi way: last three, then pairs (1,00,00,000). */
function groupBangladeshi(digits: string): string {
    if (digits.length <= 3) {
        return digits;
    }
    const lastThree = digits.slice(-3);
    const rest = digits.slice(0, -3);
    const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return `${pairs},${lastThree}`;
}

export interface FormatTakaOptions {
    /** Show Bangla digits: ৳১,২৫০. Default false. */
    banglaDigits?: boolean;
    /** Include the ৳ sign. Default true. */
    symbol?: boolean;
    /** `auto` shows poisha only when not zero (default); `always` always shows two decimals. */
    decimals?: 'auto' | 'always';
}

/** Formats minor units for display: `৳1,250`, `৳1,00,000`, `-৳150`, `৳99.50`. */
export function formatTaka(minor: number, options: FormatTakaOptions = {}): string {
    assertMinor(minor);
    const { banglaDigits = false, symbol = true, decimals = 'auto' } = options;
    const absolute = Math.abs(minor);
    const whole = Math.floor(absolute / MINOR_PER_TAKA);
    const poisha = absolute % MINOR_PER_TAKA;
    let text = groupBangladeshi(String(whole));
    if (decimals === 'always' || poisha !== 0) {
        text += '.' + String(poisha).padStart(2, '0');
    }
    if (symbol) {
        text = '৳' + text;
    }
    if (minor < 0) {
        text = '-' + text;
    }
    return banglaDigits ? asciiToBanglaDigits(text) : text;
}

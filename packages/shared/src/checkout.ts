import { z } from 'zod';
import { parseBdMobile } from './phone';
import { isPlaceholderEmail } from './placeholder-email';
import { type SettingsFieldError, toSettingsFieldErrors } from './store-settings';
import { banglaToAsciiDigits, cleanText } from './text';

/**
 * Phone-first checkout (roadmap phase 03): the checks the Shop API applies to what a shopper types,
 * shared with the storefront (phase 14) so both say the same thing. Results are error codes, not
 * sentences, so each app shows them in Bangla or English.
 */

/** Field limits, in characters (Unicode code points). */
export const CHECKOUT_LIMITS = {
    name: 100,
    email: 254,
    streetLine: 300,
    area: 120,
    landmark: 120,
    postalCode: 10,
    note: 500,
    /** The merchant's minimum address length must be within this range. */
    minAddressLengthMax: 100,
} as const;

/** Length as people count it: emoji and Bangla letters are one each, not two UTF-16 units. */
export function textLength(text: string): number {
    return [...text].length;
}

export type CheckoutPhoneResult =
    | {
          ok: true;
          e164: string;
          /** False for a foreign number (accepted only when the store allows them; never sent SMS). */
          bdMobile: boolean;
      }
    | { ok: false; code: 'INVALID_PHONE' | 'NOT_A_MOBILE' };

/** `+` or `00`, then a country code that isn't 0, 8–15 digits in all (E.164). */
const INTERNATIONAL = /^(?:\+|00)([1-9]\d{7,14})$/;

/**
 * The shopper's phone. A Bangladeshi mobile in any common form (Bangla digits, `+880`, dashes);
 * a landline is `NOT_A_MOBILE` ("enter a mobile number"). A foreign number is accepted only with
 * `allowInternational`, written with `+` or `00`.
 */
export function parseCheckoutPhone(
    input: string,
    options: { allowInternational?: boolean } = {},
): CheckoutPhoneResult {
    const result = parseBdMobile(input);
    if (result.ok) {
        return { ok: true, e164: result.phone.e164, bdMobile: true };
    }
    if (result.code === 'NOT_MOBILE') {
        return { ok: false, code: 'NOT_A_MOBILE' };
    }
    if (options.allowInternational) {
        const compact = banglaToAsciiDigits(cleanText(input)).replace(/[\s\-().]/g, '');
        const match = INTERNATIONAL.exec(compact);
        if (match && !match[1]!.startsWith('880')) {
            return { ok: true, e164: `+${match[1]}`, bdMobile: false };
        }
    }
    return { ok: false, code: 'INVALID_PHONE' };
}

export type CheckoutNameResult =
    { ok: true; name: string } | { ok: false; code: 'NAME_REQUIRED' | 'NAME_TOO_LONG' };

/** One full name, as typed: Bangla, English, one word or several, emoji. Trimmed; never split. */
export function parseCheckoutName(input: string): CheckoutNameResult {
    const name = cleanText(input);
    if (name === '') {
        return { ok: false, code: 'NAME_REQUIRED' };
    }
    if (textLength(name) > CHECKOUT_LIMITS.name) {
        return { ok: false, code: 'NAME_TOO_LONG' };
    }
    return { ok: true, name };
}

export type CheckoutEmailResult = { ok: true; email: string | null } | { ok: false; code: 'INVALID_EMAIL' };

/** An optional real email, lowercased. Blank is fine (`null`); a `.invalid` address is not accepted. */
export function parseCheckoutEmail(input: string | null | undefined): CheckoutEmailResult {
    const email = cleanText(input ?? '').toLowerCase();
    if (email === '') {
        return { ok: true, email: null };
    }
    if (
        email.length > CHECKOUT_LIMITS.email ||
        !z.email().safeParse(email).success ||
        isPlaceholderEmail(email)
    ) {
        return { ok: false, code: 'INVALID_EMAIL' };
    }
    return { ok: true, email };
}

/** The merchant's checkout choices (Vendure's settings store, `bdCheckout.settings`). */
export const checkoutSettingsSchema = z.object({
    /** Show the optional email field. */
    showEmail: z.boolean(),
    showAlternatePhone: z.boolean(),
    /** Show the "note for the order" field. */
    showNote: z.boolean(),
    /** The shortest address (house, road, village) accepted, in characters. */
    minAddressLength: z
        .number()
        .int('invalid')
        .min(0, 'invalid')
        .max(CHECKOUT_LIMITS.minAddressLengthMax, 'invalid'),
    /** Accept foreign mobile numbers (they're never sent SMS). Off by default. */
    allowInternationalPhones: z.boolean(),
});

export type CheckoutSettings = z.output<typeof checkoutSettingsSchema>;

export function defaultCheckoutSettings(): CheckoutSettings {
    return {
        showEmail: false,
        showAlternatePhone: true,
        showNote: true,
        minAddressLength: 10,
        allowInternationalPhones: false,
    };
}

export type ParseCheckoutSettingsResult =
    { ok: true; settings: CheckoutSettings } | { ok: false; errors: SettingsFieldError[] };

export function parseCheckoutSettings(input: unknown): ParseCheckoutSettingsResult {
    const result = checkoutSettingsSchema.safeParse(input);
    return result.success
        ? { ok: true, settings: result.data }
        : { ok: false, errors: toSettingsFieldErrors(result.error.issues) };
}

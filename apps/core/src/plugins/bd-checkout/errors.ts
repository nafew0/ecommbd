import { ErrorResult } from '@vendure/core';

/** Every reason a checkout mutation can refuse. Messages: `errorResult.BD_CHECKOUT.<code>` in i18n.ts. */
export const CHECKOUT_ERROR_CODES = [
    'INVALID_PHONE',
    'NOT_A_MOBILE',
    'NAME_REQUIRED',
    'NAME_TOO_LONG',
    'INVALID_ALTERNATE_PHONE',
    'INVALID_EMAIL',
    'UNKNOWN_DISTRICT',
    'THANA_NOT_IN_DISTRICT',
    'AREA_REQUIRED',
    'ADDRESS_TOO_SHORT',
    'ADDRESS_TOO_LONG',
    'FIELD_TOO_LONG',
    'NOTE_TOO_LONG',
    'RATE_LIMITED',
    'NO_ACTIVE_ORDER',
    'ALREADY_LOGGED_IN',
] as const;

export type CheckoutErrorCode = (typeof CHECKOUT_ERROR_CODES)[number];

/**
 * A Vendure error result: the Shop API returns it in place of the Order, and Vendure translates
 * `message` into the request's language (`?languageCode=bn`).
 */
export class BdCheckoutError extends ErrorResult {
    readonly __typename = 'BdCheckoutError';
    readonly errorCode = 'BD_CHECKOUT_ERROR' as never;
    readonly message: string;

    constructor(
        readonly reason: CheckoutErrorCode,
        /** The input field to highlight, e.g. `phone`. */
        readonly field: string | null = null,
        readonly retryAfterSeconds: number | null = null,
    ) {
        super();
        this.message = `BD_CHECKOUT.${reason}`;
    }
}

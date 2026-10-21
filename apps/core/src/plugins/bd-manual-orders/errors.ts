import type { ManualOrderErrorCode } from '@ecommbd/shared';
import { ErrorResult } from '@vendure/core';

/** A refused manual order or edit, translated like Vendure's own errors (`errorResult.BD_MANUAL_ORDER.<reason>`). */
export class BdManualOrderError extends ErrorResult {
    readonly __typename = 'BdManualOrderError';
    readonly errorCode = 'BD_MANUAL_ORDER_ERROR' as never;
    readonly message: string;

    constructor(
        readonly reason: ManualOrderErrorCode,
        /** Products short of stock, the address problem, or the payment's own message. */
        readonly details: string[] = [],
    ) {
        super();
        this.message = `BD_MANUAL_ORDER.${reason}`;
    }
}

/** Thrown inside a transaction to roll it back, then returned as the error result. */
export class Refusal extends Error {
    constructor(readonly error: BdManualOrderError) {
        super(error.reason);
    }
}

export const refuse = (reason: ManualOrderErrorCode, details: string[] = []) =>
    new Refusal(new BdManualOrderError(reason, details));

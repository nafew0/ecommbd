/** Why a courier action didn't happen. Each has a message in `i18n.ts` (`errorResult.BD_COURIER.<code>`). */
export type CourierErrorCode =
    | 'ORDER_NOT_FOUND'
    | 'NOT_READY'
    | 'NO_COURIER'
    | 'COURIER_OFF'
    | 'UNMAPPED_ADDRESS'
    | 'NO_PHONE'
    | 'NO_PATHAO_STORE'
    | 'COURIER_REFUSED'
    /** No clear answer: the courier may have made the parcel (booking kept, unconfirmed). */
    | 'COURIER_UNAVAILABLE'
    /** Too many requests, or calls paused after failures: surely no parcel, tried again later. */
    | 'COURIER_BUSY'
    /** Unconfirmed, and the courier can't be asked by invoice (Pathao): staff check its panel. */
    | 'CHECK_COURIER_PANEL'
    | 'ALREADY_BOOKED'
    | 'NOT_BOOKED'
    | 'ALREADY_PICKED_UP'
    | 'INVALID_INPUT';

export class CourierActionError extends Error {
    /** Whether a booking row already shows this failure (bulk booking writes one when not). */
    recorded = false;

    constructor(
        readonly code: CourierErrorCode,
        readonly detail?: string,
    ) {
        super(code);
    }

    /** Marks the failure as shown on a booking row. */
    shown(): this {
        this.recorded = true;
        return this;
    }
}

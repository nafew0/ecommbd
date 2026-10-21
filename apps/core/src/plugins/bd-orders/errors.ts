import type { BdOrderStatus } from '@ecommbd/shared';
import { ErrorResult } from '@vendure/core';

/** Why an order action was refused. Messages: `errorResult.BD_ORDER.<code>` in i18n.ts. */
export const ORDER_ACTION_ERROR_CODES = [
    'ORDER_NOT_FOUND',
    'ALREADY_CHANGED',
    'NOT_ALLOWED',
    'INVALID_REASON',
    'NOTE_REQUIRED',
    'NOTE_TOO_LONG',
    'INSUFFICIENT_STOCK',
    'REFUND_REQUIRED',
    'NOT_IN_QUEUE',
    'INVALID_TIME',
    'INVALID_OUTCOME',
] as const;

export type OrderActionErrorCode = (typeof ORDER_ACTION_ERROR_CODES)[number];

export interface OrderActionErrorDetails {
    currentStatus?: BdOrderStatus | null;
    /** Who made the last status change, and when (for "Already confirmed by Karim 1 minute ago"). */
    changedBy?: string | null;
    changedAt?: Date | null;
    /** For INSUFFICIENT_STOCK: the products short of stock. For NOT_ALLOWED: Vendure's reason. */
    details?: string[];
}

/** A Vendure error result, translated into the request's language like Vendure's own. */
export class BdOrderActionError extends ErrorResult {
    readonly __typename = 'BdOrderActionError';
    readonly errorCode = 'BD_ORDER_ACTION_ERROR' as never;
    readonly message: string;
    readonly currentStatus: BdOrderStatus | null;
    readonly changedBy: string | null;
    readonly changedAt: Date | null;
    readonly details: string[];

    constructor(
        readonly reason: OrderActionErrorCode,
        extra: OrderActionErrorDetails = {},
    ) {
        super();
        this.message = `BD_ORDER.${reason}`;
        this.currentStatus = extra.currentStatus ?? null;
        this.changedBy = extra.changedBy ?? null;
        this.changedAt = extra.changedAt ?? null;
        this.details = extra.details ?? [];
    }
}

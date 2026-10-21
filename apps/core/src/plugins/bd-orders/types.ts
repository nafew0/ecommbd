import type { BdCancelReason } from '@ecommbd/shared';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        orderNumber?: string | null;
        imported?: boolean;
        cancelReason?: BdCancelReason | null;
        cancelNote?: string | null;
        confirmQueueAt?: Date | null;
        callAttempts?: number;
        lastCallAt?: Date | null;
        claimedByUserId?: string | null;
        claimedByName?: string | null;
        claimedUntil?: Date | null;
        possibleDuplicateOf?: string | null;
    }
    interface CustomOrderLineFields {
        returnedQuantity?: number;
    }
}

declare module '@vendure/core/dist/service/services/history.service' {
    interface OrderHistoryEntryData {
        BD_CALL_ATTEMPT: {
            outcome: 'noAnswer' | 'callLater';
            /** ISO time, with `callLater`. */
            callBackAt?: string;
            note?: string;
        };
    }
}

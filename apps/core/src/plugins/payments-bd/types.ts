declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomPaymentFields {
        /** `bkash:8N7A6D5E4F`: unique, so one transaction ID pays one order only. */
        mfsReference?: string | null;
    }
    interface CustomOrderFields {
        /** The shopper's choice before paying: `cod` (with any advance) or `prepaid`. */
        paymentChoice?: string | null;
    }
}

declare module '@vendure/core/dist/service/services/history.service' {
    interface OrderHistoryEntryData {
        BD_PAYMENT_CHECK: {
            paymentId: string;
            outcome: 'verified' | 'rejected';
            /** Poisha received, when verified. */
            received?: number;
            expected: number;
            reason?: string;
        };
    }
}

/** What we keep in a mobile banking payment's metadata (`public` is shown to the shopper). */
export interface MfsPaymentMetadata {
    provider: string;
    senderNumber: string;
    transactionId: string;
    purpose: 'advance' | 'full';
    verification: 'pending' | 'verified' | 'rejected';
    expectedAmount: number;
    receivedAmount?: number;
    rejectReason?: string;
    checkedBy?: string;
    checkedAt?: string;
    public: { provider: string; transactionId: string; verification: string };
}

export {};

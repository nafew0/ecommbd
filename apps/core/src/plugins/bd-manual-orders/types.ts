declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        source?: string;
        sendSms?: boolean;
    }
    interface CustomOrderLineFields {
        priceOverride?: number | null;
        originalUnitPrice?: number | null;
    }
}

declare module '@vendure/core/dist/service/services/history.service' {
    interface OrderHistoryEntryData {
        BD_ORDER_EDIT: {
            before: unknown;
            after: unknown;
            note: string;
        };
    }
}

export {};

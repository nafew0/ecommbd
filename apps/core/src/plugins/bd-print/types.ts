declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        invoicePrintedAt?: Date | null;
        slipPrintedAt?: Date | null;
        stickerPrintedAt?: Date | null;
    }
}

export {};

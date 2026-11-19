declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomStockLocationFields {
        phone?: string | null;
        districtId?: string;
        thanaId?: string;
        addressLine?: string;
        note?: string;
        sellsOnline?: boolean;
    }

    interface CustomOrderFields {
        shippingBranchId?: number | null;
        transferNeeded?: boolean;
        returnStockRestored?: boolean;
    }
}

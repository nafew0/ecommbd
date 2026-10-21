declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        freeDelivery?: boolean;
        deliveryInsideDhaka?: number | null;
        deliveryOutsideDhaka?: number | null;
        deliverySurcharge?: number;
    }
    interface CustomProductVariantFields {
        weightGrams?: number | null;
    }
}

export {};

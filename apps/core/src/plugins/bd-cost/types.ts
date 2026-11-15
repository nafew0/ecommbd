declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductVariantFields {
        /** What the merchant pays for one. Null means they haven't said. */
        unitCost?: number | null;
    }
    interface CustomOrderLineFields {
        /** The variant's cost when this line was added to a placed order. Never updated later. */
        unitCost?: number | null;
    }
}

export {};

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        seoTitle?: string | null;
        seoDescription?: string | null;
    }
    interface CustomCollectionFields {
        seoTitle?: string | null;
        seoDescription?: string | null;
    }
}

export {};

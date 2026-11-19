import type { Asset } from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomFacetValueFields {
        logo?: Asset | null;
    }
    interface CustomFacetValueFieldsTranslation {
        description?: string | null;
    }
}

export {};

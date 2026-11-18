import type { Asset, Collection } from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        featured?: boolean;
        isNew?: boolean;
        youtubeUrl?: string | null;
        feedbackAssets?: Asset[];
        category?: Collection | null;
        /** Phase 55: why a product that is off is off ('draft' or 'archived'). */
        status?: string | null;
        trashedAt?: Date | null;
        unit?: string | null;
        shippingClass?: string | null;
    }
    interface CustomProductVariantFields {
        oldPrice?: number | null;
        isDefault?: boolean;
        lengthCm?: number | null;
        widthCm?: number | null;
        heightCm?: number | null;
    }
    interface CustomCollectionFields {
        bdCategory?: boolean;
    }
}

export {};

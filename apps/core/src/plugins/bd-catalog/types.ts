import type { Asset, Collection } from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        featured?: boolean;
        isNew?: boolean;
        youtubeUrl?: string | null;
        feedbackAssets?: Asset[];
        category?: Collection | null;
    }
    interface CustomProductVariantFields {
        oldPrice?: number | null;
        isDefault?: boolean;
    }
    interface CustomCollectionFields {
        bdCategory?: boolean;
    }
}

export {};

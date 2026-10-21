import { LanguageCode, type CustomFieldConfig } from '@vendure/core';
import { BdImage } from './bd-image.entity';

/** The database column of `Asset.customFields.bdImage`, for the hand-written SQL in image.service.ts. */
export const ASSET_IMAGE_COLUMN = 'customFieldsBdimageid';

/** Every asset points at its picture's WebP sizes. Set by the image job only. */
export const assetImageCustomFields: CustomFieldConfig[] = [
    {
        name: 'bdImage',
        type: 'relation',
        entity: BdImage,
        graphQLType: 'BdImage',
        eager: true,
        nullable: true,
        public: true,
        readonly: true,
        label: [
            { languageCode: LanguageCode.en, value: 'WebP sizes' },
            { languageCode: LanguageCode.bn, value: 'WebP সাইজ' },
        ],
    },
];

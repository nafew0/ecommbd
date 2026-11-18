import { Asset, type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/** A brand is a value of the `brand` facet; these give it a logo and a description (phase 55). */
export const facetValueBrandCustomFields: CustomFieldConfig[] = [
    {
        name: 'logo',
        type: 'relation',
        entity: Asset,
        nullable: true,
        public: true,
        label: text('Logo', 'লোগো'),
    },
    {
        name: 'description',
        type: 'localeText',
        nullable: true,
        public: true,
        label: text('Description', 'বর্ণনা'),
    },
];

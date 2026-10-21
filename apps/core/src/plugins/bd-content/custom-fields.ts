import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

/**
 * SEO title and description on products and categories, per language (roadmap phase 12). Empty
 * means the storefront uses the name and the start of the description. Phase 05's product form
 * shows them in its "More" part.
 */
export const seoCustomFields: CustomFieldConfig[] = [
    {
        name: 'seoTitle',
        type: 'localeString',
        nullable: true,
        public: true,
        length: 255,
        label: [
            { languageCode: LanguageCode.en, value: 'SEO title' },
            { languageCode: LanguageCode.bn, value: 'SEO টাইটেল' },
        ],
        description: [{ languageCode: LanguageCode.en, value: 'About 60 characters; shown by Google' }],
        ui: { tab: 'SEO' },
    },
    {
        name: 'seoDescription',
        type: 'localeText',
        nullable: true,
        public: true,
        label: [
            { languageCode: LanguageCode.en, value: 'SEO description' },
            { languageCode: LanguageCode.bn, value: 'SEO বিবরণ' },
        ],
        description: [{ languageCode: LanguageCode.en, value: 'About 155 characters; shown by Google' }],
        ui: { tab: 'SEO' },
    },
];

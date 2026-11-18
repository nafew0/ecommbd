import { CATALOG_LIMITS, isWholeTaka } from '@ecommbd/shared';
import { Asset, Collection, type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/** Product fields of the one-page product form (phase 05). The delivery fields are phase 07's. */
export const productCatalogCustomFields: CustomFieldConfig[] = [
    {
        name: 'featured',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: true,
        label: text('Featured', 'ফিচার্ড'),
    },
    {
        name: 'isNew',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: true,
        label: text('New', 'নতুন'),
    },
    {
        name: 'youtubeUrl',
        type: 'string',
        length: 500,
        nullable: true,
        public: true,
        label: text('YouTube video', 'ইউটিউব ভিডিও'),
    },
    {
        name: 'shortDescription',
        type: 'localeText',
        nullable: true,
        public: true,
        label: text('Short description', 'ছোট বর্ণনা'),
    },
    // seoTitle and seoDescription come from bd-content (phase 12); the product form edits them.
    {
        name: 'feedbackAssets',
        type: 'relation',
        entity: Asset,
        list: true,
        public: true,
        label: text('Customer feedback images', 'ক্রেতাদের মতামতের ছবি'),
        description: text(
            'Screenshots of reviews, shown on the product page',
            'রিভিউয়ের স্ক্রিনশট, পণ্যের পাতায় দেখাবে',
        ),
    },
    {
        name: 'category',
        type: 'relation',
        entity: Collection,
        public: true,
        nullable: true,
        label: text('Category', 'ক্যাটাগরি'),
    },
    // Phase 55. `enabled` stays the switch the storefront reads; `status` says why a product
    // that is off is off (draft or archived). See productStatusOf in @ecommbd/shared.
    {
        name: 'status',
        type: 'string',
        length: 16,
        nullable: true,
        public: false,
        readonly: true,
        label: text('Status', 'অবস্থা'),
    },
    {
        name: 'trashedAt',
        type: 'datetime',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Moved to the trash', 'ট্র্যাশে সরানো হয়েছে'),
    },
    {
        name: 'unit',
        type: 'string',
        length: 40,
        nullable: true,
        public: true,
        label: text('Unit', 'একক'),
        description: text('Shown next to the price, e.g. per kg', 'দামের পাশে দেখাবে, যেমন প্রতি কেজি'),
    },
    {
        name: 'shippingClass',
        type: 'string',
        length: 40,
        nullable: true,
        public: false,
        label: text('Shipping class', 'শিপিং ক্লাস'),
    },
];

export const variantCatalogCustomFields: CustomFieldConfig[] = [
    {
        name: 'oldPrice',
        type: 'int',
        nullable: true,
        public: true,
        label: text('Old price (struck through)', 'আগের দাম (কেটে দেখাবে)'),
        validate: (value: unknown) =>
            value == null ||
            (Number.isSafeInteger(value) &&
                (value as number) > 0 &&
                (value as number) <= CATALOG_LIMITS.maxPrice &&
                isWholeTaka(value as number))
                ? undefined
                : 'The old price must be whole taka',
    },
    {
        name: 'isDefault',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: true,
        label: text('Shown first', 'প্রথমে দেখাবে'),
    },
    // Phase 55: parcel size next to the weight, whole centimetres.
    ...(['length', 'width', 'height'] as const).map(
        (side): CustomFieldConfig => ({
            name: `${side}Cm`,
            type: 'int',
            nullable: true,
            public: false,
            label: {
                length: text('Length (cm)', 'দৈর্ঘ্য (সেমি)'),
                width: text('Width (cm)', 'প্রস্থ (সেমি)'),
                height: text('Height (cm)', 'উচ্চতা (সেমি)'),
            }[side],
            validate: (value: unknown) =>
                value == null ||
                (Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= CATALOG_LIMITS.maxCm)
                    ? undefined
                    : 'Enter whole centimetres',
        }),
    ),
];

/** Our categories are collections marked with this, filled by the products' category field. */
export const collectionCatalogCustomFields: CustomFieldConfig[] = [
    {
        name: 'bdCategory',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: false,
        readonly: true,
        label: text('Store category', 'স্টোরের ক্যাটাগরি'),
    },
];

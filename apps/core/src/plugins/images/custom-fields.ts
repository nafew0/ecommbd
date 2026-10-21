import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/** What the image pipeline knows about an asset. Public: the storefront builds `srcset` from it. */
export const assetImageCustomFields: CustomFieldConfig[] = [
    {
        name: 'contentHash',
        type: 'string',
        length: 64,
        nullable: true,
        index: true,
        public: true,
        readonly: true,
        label: text('Image key', 'ছবির কী'),
    },
    {
        name: 'imageWidths',
        type: 'string',
        length: 64,
        nullable: true,
        public: true,
        readonly: true,
        label: text('Image sizes', 'ছবির সাইজ'),
    },
    {
        name: 'dominantColor',
        type: 'string',
        length: 7,
        nullable: true,
        public: true,
        readonly: true,
        label: text('Main colour', 'প্রধান রং'),
    },
    {
        name: 'placeholder',
        type: 'text',
        nullable: true,
        public: true,
        readonly: true,
        label: text('Placeholder', 'প্লেসহোল্ডার'),
    },
    {
        name: 'imageStatus',
        type: 'string',
        length: 16,
        nullable: false,
        defaultValue: 'pending',
        options: [{ value: 'pending' }, { value: 'ready' }, { value: 'failed' }],
        public: true,
        readonly: true,
        label: text('Image processing', 'ছবি তৈরি'),
    },
    {
        name: 'variantBytes',
        type: 'int',
        nullable: false,
        defaultValue: 0,
        public: false,
        readonly: true,
        label: text('Size of the image versions (bytes)', 'ছবির সংস্করণগুলোর আকার (বাইট)'),
    },
];

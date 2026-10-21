import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

export const paymentCustomFields: CustomFieldConfig[] = [
    {
        name: 'mfsReference',
        type: 'string',
        length: 40,
        nullable: true,
        // One bKash/Nagad/Rocket transaction pays one order only. NULLs (other payments) don't collide.
        unique: true,
        public: false,
        readonly: true,
        label: text('Mobile banking transaction', 'মোবাইল ব্যাংকিং ট্রানজেকশন'),
    },
];

export const orderPaymentCustomFields: CustomFieldConfig[] = [
    {
        name: 'paymentChoice',
        type: 'string',
        length: 16,
        nullable: true,
        options: [{ value: 'cod' }, { value: 'prepaid' }],
        public: true,
        readonly: true,
        label: text('Payment choice', 'পেমেন্টের ধরন'),
    },
];

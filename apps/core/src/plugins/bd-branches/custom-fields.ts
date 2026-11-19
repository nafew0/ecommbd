import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/** A branch's address and whether the website sells from it. Stock itself stays in stock_level. */
export const stockLocationBranchFields: CustomFieldConfig[] = [
    {
        name: 'phone',
        type: 'string',
        length: 20,
        nullable: true,
        public: false,
        label: text('Phone', 'ফোন নম্বর'),
    },
    {
        name: 'districtId',
        type: 'string',
        length: 16,
        defaultValue: '',
        public: false,
        label: text('District', 'জেলা'),
    },
    {
        name: 'thanaId',
        type: 'string',
        length: 16,
        defaultValue: '',
        public: false,
        label: text('Thana', 'থানা'),
    },
    {
        name: 'addressLine',
        type: 'string',
        length: 200,
        defaultValue: '',
        public: false,
        label: text('Address', 'ঠিকানা'),
    },
    {
        name: 'note',
        type: 'text',
        defaultValue: '',
        public: false,
        label: text('Note', 'নোট'),
    },
    {
        name: 'sellsOnline',
        type: 'boolean',
        defaultValue: false,
        public: false,
        label: text('Sells online', 'অনলাইনে বিক্রি'),
        description: text(
            'Orders are taken from this branch when the zone has no default of its own',
            'জোনের নিজস্ব শাখা না থাকলে অর্ডার এই শাখা থেকে ধরা হয়',
        ),
    },
];

/** Written when the order is placed. Staff see them through bdOrderBranch, not by editing the order. */
export const orderBranchFields: CustomFieldConfig[] = [
    {
        name: 'shippingBranchId',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Ships from', 'যে শাখা থেকে যাবে'),
    },
    {
        name: 'transferNeeded',
        type: 'boolean',
        defaultValue: false,
        public: false,
        readonly: true,
        label: text('Transfer needed', 'ট্রান্সফার লাগবে'),
    },
    {
        name: 'returnStockRestored',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        internal: true,
        label: text('Return stock restored', 'ফেরতের স্টক যোগ হয়েছে'),
    },
];

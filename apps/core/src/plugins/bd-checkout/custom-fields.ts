import { CHECKOUT_LIMITS } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const E164 = /^\+[1-9]\d{7,14}$/;

/** A count kept up to date from orders (CustomerStatsService). Never edited by hand. */
const stat = (name: string, en: string, bn: string): CustomFieldConfig => ({
    name,
    type: 'int',
    defaultValue: 0,
    nullable: false,
    public: false,
    readonly: true,
    label: text(en, bn),
});

/**
 * Our fields on Vendure's Customer (roadmap phase 03). None is in the Shop API: shoppers never see
 * customer records. Phone, source and the stats are written only by our code.
 */
export const customerCustomFields: CustomFieldConfig[] = [
    {
        name: 'phone',
        type: 'string',
        length: 20,
        nullable: true,
        // The customer's identity: one customer per phone. NULLs don't collide.
        unique: true,
        public: false,
        readonly: true,
        label: text('Phone', 'ফোন'),
        description: text('Mobile number in E.164, e.g. +8801712345678', 'মোবাইল নম্বর, যেমন +8801712345678'),
        validate: (value: unknown) =>
            value == null || E164.test(String(value)) ? undefined : 'The phone must be in E.164 form',
    },
    {
        name: 'alternatePhone',
        type: 'string',
        length: 20,
        nullable: true,
        public: false,
        readonly: true,
        label: text('Alternate phone', 'বিকল্প ফোন নম্বর'),
    },
    {
        name: 'source',
        type: 'string',
        length: 16,
        nullable: false,
        defaultValue: 'web',
        options: [{ value: 'web' }, { value: 'manual' }, { value: 'import' }],
        public: false,
        readonly: true,
        label: text('Source', 'উৎস'),
        description: text(
            'web: the storefront; manual: entered by staff; import: from WooCommerce',
            'web: ওয়েবসাইট; manual: স্টাফ; import: WooCommerce থেকে',
        ),
    },
    {
        name: 'internalNotes',
        type: 'text',
        nullable: true,
        public: false,
        label: text('Internal notes', 'ভেতরের নোট'),
        description: text('Only staff see these', 'শুধু স্টাফরা দেখতে পান'),
        validate: (value: unknown) =>
            value == null || String(value).length <= 2000
                ? undefined
                : 'Notes can be at most 2000 characters',
    },
    stat('orderCount', 'Orders', 'অর্ডার'),
    stat('deliveredCount', 'Delivered', 'ডেলিভারি হয়েছে'),
    stat('returnedCount', 'Returned', 'ফেরত এসেছে'),
    stat('cancelledCount', 'Cancelled', 'বাতিল'),
    stat('totalSpent', 'Total spent (poisha, delivered orders)', 'মোট কেনাকাটা (পয়সা)'),
    {
        name: 'lastOrderAt',
        type: 'datetime',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Last order', 'শেষ অর্ডার'),
    },
];

/** Our fields on Vendure's Order for the checkout (roadmap phase 03). Written only by our code. */
export const orderCheckoutCustomFields: CustomFieldConfig[] = [
    {
        name: 'customerNote',
        type: 'string',
        length: CHECKOUT_LIMITS.note,
        nullable: true,
        public: true,
        readonly: true,
        label: text('Customer note', 'কাস্টমারের নোট'),
    },
    {
        name: 'contactEmail',
        type: 'string',
        length: CHECKOUT_LIMITS.email,
        nullable: true,
        public: false,
        readonly: true,
        label: text('Contact email', 'যোগাযোগের ইমেইল'),
        description: text(
            'An email given at checkout that belongs to another customer',
            'চেকআউটে দেওয়া ইমেইল, যা অন্য কাস্টমারের',
        ),
    },
    {
        name: 'locale',
        type: 'string',
        length: 5,
        nullable: true,
        public: false,
        readonly: true,
        label: text('Shopper language', 'কাস্টমারের ভাষা'),
        description: text('bn or en, for SMS', 'bn বা en, SMS-এর জন্য'),
    },
];

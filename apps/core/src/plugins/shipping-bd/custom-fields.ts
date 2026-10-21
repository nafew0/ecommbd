import { isWholeTaka, SHIPPING_LIMITS } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const charge = (value: unknown) =>
    value == null ||
    (Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= SHIPPING_LIMITS.maxCharge &&
        isWholeTaka(value as number))
        ? undefined
        : 'A delivery charge must be whole taka between 0 and 10,000';

/**
 * Delivery fields on products (roadmap phase 07; the product form comes in phase 05). Amounts are
 * poisha. Blank charges mean the store's rate.
 */
export const productDeliveryCustomFields: CustomFieldConfig[] = [
    {
        name: 'freeDelivery',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: true,
        label: text('Free delivery', 'ফ্রি ডেলিভারি'),
    },
    {
        name: 'deliveryInsideDhaka',
        type: 'int',
        nullable: true,
        public: true,
        label: text('Delivery charge inside Dhaka', 'ঢাকার ভেতরে ডেলিভারি চার্জ'),
        description: text('Blank: the store’s charge', 'খালি রাখলে স্টোরের চার্জ'),
        validate: charge,
    },
    {
        name: 'deliveryOutsideDhaka',
        type: 'int',
        nullable: true,
        public: true,
        label: text('Delivery charge outside Dhaka', 'ঢাকার বাইরে ডেলিভারি চার্জ'),
        description: text('Blank: the store’s charge', 'খালি রাখলে স্টোরের চার্জ'),
        validate: charge,
    },
    {
        name: 'deliverySurcharge',
        type: 'int',
        defaultValue: 0,
        nullable: false,
        public: false,
        label: text('Extra delivery charge per item', 'প্রতি পণ্যে বাড়তি ডেলিভারি চার্জ'),
        description: text('For heavy or fragile items', 'ভারী বা ভঙ্গুর পণ্যের জন্য'),
        validate: charge,
    },
];

/** A delivery charge staff typed for this order (manual orders and edits, phase 05); null: the rules. */
export const orderDeliveryCustomFields: CustomFieldConfig[] = [
    {
        name: 'deliveryChargeOverride',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Delivery charge set by staff', 'স্টাফের দেওয়া ডেলিভারি চার্জ'),
        validate: charge,
    },
];

export const variantDeliveryCustomFields: CustomFieldConfig[] = [
    {
        name: 'weightGrams',
        type: 'int',
        nullable: true,
        public: false,
        label: text('Weight (grams)', 'ওজন (গ্রাম)'),
        validate: (value: unknown) =>
            value == null ||
            (Number.isSafeInteger(value) &&
                (value as number) >= 0 &&
                (value as number) <= SHIPPING_LIMITS.maxGrams)
                ? undefined
                : 'Weight must be whole grams between 0 and 1,000,000',
    },
];

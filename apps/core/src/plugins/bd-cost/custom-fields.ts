import { CATALOG_LIMITS, isWholeTaka } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';
import { readCostPermission } from './constants';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const cost = (value: unknown) =>
    value == null ||
    (Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= CATALOG_LIMITS.maxPrice &&
        isWholeTaka(value as number))
        ? undefined
        : 'Cost must be whole taka';

/** What one variation costs the merchant. Shoppers never see it, and neither does a role without ReadCost. */
export const variantCostCustomFields: CustomFieldConfig[] = [
    {
        name: 'unitCost',
        type: 'int',
        nullable: true,
        public: false,
        requiresPermission: readCostPermission.Permission,
        label: text('Cost', 'ক্রয়মূল্য'),
        description: text(
            'What you pay for one. Empty means the profit is unknown',
            'একটির ক্রয়মূল্য। খালি থাকলে লাভ অজানা',
        ),
        validate: cost,
    },
];

/**
 * The cost copied onto the line when the order is placed, or when a line is added to a placed
 * order. Readonly so no API client can change a past order's cost.
 */
export const orderLineCostCustomFields: CustomFieldConfig[] = [
    {
        name: 'unitCost',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        requiresPermission: readCostPermission.Permission,
        label: text('Cost when ordered', 'অর্ডারের সময়ের ক্রয়মূল্য'),
        validate: cost,
    },
];

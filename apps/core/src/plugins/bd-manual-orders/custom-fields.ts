import { ORDER_SOURCES } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';
import { overridePricePermission } from './constants';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

export const orderManualCustomFields: CustomFieldConfig[] = [
    {
        name: 'source',
        type: 'string',
        length: 20,
        nullable: false,
        defaultValue: 'web',
        options: [{ value: 'web' }, ...ORDER_SOURCES.map(value => ({ value }))],
        public: false,
        readonly: true,
        label: text('Where the order came from', 'অর্ডার কোথা থেকে'),
    },
    {
        name: 'sendSms',
        type: 'boolean',
        nullable: false,
        defaultValue: true,
        public: false,
        readonly: true,
        label: text('Send SMS to the customer', 'কাস্টমারকে SMS পাঠান'),
    },
];

/**
 * A price staff typed for one line (OverridePrice), and the price it replaced. Only staff with
 * OverridePrice can set it, in any API; shoppers never see it.
 */
export const orderLineManualCustomFields: CustomFieldConfig[] = [
    {
        name: 'priceOverride',
        type: 'int',
        nullable: true,
        public: false,
        requiresPermission: [overridePricePermission.Permission],
        label: text('Price set by staff', 'স্টাফের দেওয়া দাম'),
    },
    {
        name: 'originalUnitPrice',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Price before the change', 'আগের দাম'),
    },
];

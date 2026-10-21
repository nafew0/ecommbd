import { BD_CANCEL_REASONS, CHECKOUT_LIMITS } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/** Queue bookkeeping: not in the GraphQL API at all; our `Order.bd` field shows what staff need. */
const internal = (config: CustomFieldConfig): CustomFieldConfig => ({
    nullable: true,
    ...config,
    internal: true,
});

/** Our fields on Vendure's Order for the BD workflow (roadmap phase 04). */
export const orderWorkflowCustomFields: CustomFieldConfig[] = [
    {
        name: 'orderNumber',
        type: 'string',
        length: 32,
        nullable: true,
        unique: true,
        public: true,
        readonly: true,
        label: text('Order number', 'অর্ডার নম্বর'),
        description: text(
            'Given when the order is placed, e.g. 1001 or MF-1001',
            'অর্ডার হলে দেওয়া হয়, যেমন ১০০১',
        ),
    },
    {
        name: 'imported',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: false,
        readonly: true,
        label: text('Imported', 'ইমপোর্ট করা'),
        description: text(
            'Brought from WooCommerce: never enters the confirmation queue or fires order events',
            'WooCommerce থেকে আনা',
        ),
    },
    {
        name: 'cancelReason',
        type: 'string',
        length: 32,
        nullable: true,
        public: false,
        options: BD_CANCEL_REASONS.map(value => ({ value })),
        label: text('Cancel reason', 'বাতিলের কারণ'),
        description: text('Needed to cancel a placed order', 'অর্ডার বাতিল করতে লাগবে'),
    },
    {
        name: 'cancelNote',
        type: 'string',
        length: CHECKOUT_LIMITS.note,
        nullable: true,
        public: false,
        label: text('Cancel note', 'বাতিলের নোট'),
    },
    internal({ name: 'confirmQueueAt', type: 'datetime', index: true }),
    internal({ name: 'callAttempts', type: 'int', defaultValue: 0, nullable: false }),
    internal({ name: 'lastCallAt', type: 'datetime' }),
    internal({ name: 'claimedByUserId', type: 'string', length: 40 }),
    internal({ name: 'claimedByName', type: 'string', length: 120 }),
    internal({ name: 'claimedUntil', type: 'datetime' }),
    internal({ name: 'possibleDuplicateOf', type: 'string', length: 32 }),
];

export const orderLineWorkflowCustomFields: CustomFieldConfig[] = [
    {
        name: 'returnedQuantity',
        type: 'int',
        defaultValue: 0,
        nullable: false,
        public: false,
        readonly: true,
        label: text('Returned quantity', 'ফেরত আসা পরিমাণ'),
        description: text(
            'For partial deliveries: how many came back (returns workflow in phase 37)',
            'আংশিক ডেলিভারিতে কতগুলো ফেরত এসেছে',
        ),
    },
];

import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

/**
 * Our fields on Vendure's Address. Vendure copies Address custom fields onto order addresses
 * (OrderAddress and its inputs), so customer and order addresses carry the same data.
 *
 * Vendure's own fields are used like this (docs/decisions.md, 2026-10-21):
 * - `streetLine1`: house, road, village; `streetLine2` is unused by our forms;
 * - `city`: the thana's English name, `province`: the district's English name (filled by the server);
 * - `postalCode`: optional; `countryCode`: BD.
 */
export const addressCustomFields: CustomFieldConfig[] = [
    {
        name: 'districtId',
        type: 'string',
        length: 16,
        nullable: true,
        public: true,
        label: text('District', 'জেলা'),
        description: text(
            'Place ID from @ecommbd/bd-geo, e.g. BD3026 (Dhaka)',
            'জেলার আইডি, যেমন BD3026 (ঢাকা)',
        ),
    },
    {
        name: 'thanaId',
        type: 'string',
        length: 16,
        nullable: true,
        public: true,
        label: text('Thana / Upazila', 'থানা / উপজেলা'),
        description: text(
            'Place ID, or "other" when the place is not listed',
            'থানার আইডি, তালিকায় না থাকলে "other"',
        ),
    },
    {
        name: 'area',
        type: 'string',
        length: 120,
        nullable: true,
        public: true,
        label: text('Area', 'এলাকা'),
        description: text(
            'For example "Mirpur 10" or "Banasree Block C"',
            'যেমন "মিরপুর ১০" বা "বনশ্রী ব্লক সি"',
        ),
    },
    {
        name: 'landmark',
        type: 'string',
        length: 120,
        nullable: true,
        public: true,
        label: text('Landmark', 'ল্যান্ডমার্ক'),
    },
    {
        name: 'alternatePhone',
        type: 'string',
        length: 20,
        nullable: true,
        public: true,
        label: text('Alternate phone', 'বিকল্প ফোন নম্বর'),
    },
];

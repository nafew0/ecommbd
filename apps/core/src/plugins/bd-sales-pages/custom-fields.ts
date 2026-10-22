import { ATTRIBUTION_LIMITS } from '@ecommbd/shared';
import { type CustomFieldConfig, LanguageCode } from '@vendure/core';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const field = (name: string, length: number, en: string, bn: string): CustomFieldConfig => ({
    name,
    type: 'string',
    length,
    nullable: true,
    public: false,
    readonly: true,
    label: text(en, bn),
});

/**
 * Where an order came from (roadmap phase 16): the sales page it was placed on (or that the ad led
 * to), and the ad or link of the shopper's last visit that wasn't direct. Written only by our code;
 * plain text that anyone can put in a link, so the admin shows it escaped.
 */
export const orderAttributionCustomFields: CustomFieldConfig[] = [
    field('salesPageId', ATTRIBUTION_LIMITS.salesPage, 'Sales page', 'সেলস পেজ'),
    field('utmSource', ATTRIBUTION_LIMITS.text, 'Source (utm_source)', 'উৎস (utm_source)'),
    field('utmMedium', ATTRIBUTION_LIMITS.text, 'Medium (utm_medium)', 'মাধ্যম (utm_medium)'),
    field('utmCampaign', ATTRIBUTION_LIMITS.text, 'Campaign (utm_campaign)', 'ক্যাম্পেইন (utm_campaign)'),
    field('utmContent', ATTRIBUTION_LIMITS.text, 'Ad (utm_content)', 'বিজ্ঞাপন (utm_content)'),
    field('utmTerm', ATTRIBUTION_LIMITS.text, 'Keyword (utm_term)', 'কিওয়ার্ড (utm_term)'),
    field('fbclid', ATTRIBUTION_LIMITS.clickId, 'Facebook click ID', 'ফেসবুক ক্লিক আইডি'),
    field('gclid', ATTRIBUTION_LIMITS.clickId, 'Google click ID', 'গুগল ক্লিক আইডি'),
    field('ttclid', ATTRIBUTION_LIMITS.clickId, 'TikTok click ID', 'টিকটক ক্লিক আইডি'),
    field('referrer', ATTRIBUTION_LIMITS.referrer, 'Came from (site)', 'যে সাইট থেকে এসেছেন'),
    {
        name: 'attributedAt',
        type: 'datetime',
        nullable: true,
        public: false,
        readonly: true,
        label: text('Visit from the ad or link', 'বিজ্ঞাপন বা লিংক থেকে আসার সময়'),
    },
];

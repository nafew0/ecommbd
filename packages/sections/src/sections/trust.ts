import { defineSection } from '../define';
import { field } from '../fields';
import { heading, ICON_OPTIONS, L, text } from './common';

export const testimonials = defineSection({
    type: 'testimonials',
    version: 1,
    name: { bn: 'কাস্টমারের মতামত', en: 'Customer reviews' },
    description: {
        bn: 'কাস্টমারের কথা: কার্ড হিসেবে বা মেসেজের স্ক্রিনশট',
        en: 'What customers say: as cards or as message screenshots',
    },
    category: 'trust',
    icon: 'testimonials',
    fields: {
        heading: heading({ bn: 'কাস্টমাররা যা বলছেন', en: 'What our customers say' }),
        look: field.select(
            { bn: 'দেখতে', en: 'Look' },
            [
                { value: 'cards', label: { bn: 'কার্ড', en: 'Cards' } },
                { value: 'screenshots', label: { bn: 'স্ক্রিনশট', en: 'Screenshots' } },
            ],
            'cards',
        ),
        columns: field.range(L.columns, { min: 1, max: 4 }, 3),
    },
    blocks: {
        label: { bn: 'মতামত', en: 'Review' },
        min: 1,
        max: 12,
        titleField: 'name',
        fields: {
            name: field.text({ bn: 'নাম', en: 'Name' }, undefined, { max: 80 }),
            place: field.text({ bn: 'এলাকা', en: 'Area' }, undefined, { max: 80 }),
            text: field.textarea({ bn: 'মতামত', en: 'Review' }, undefined, { max: 600 }),
            rating: field.range({ bn: 'তারা', en: 'Stars' }, { min: 0, max: 5 }, 5, {
                hint: { bn: '০ দিলে তারা দেখাবে না', en: '0 shows no stars' },
            }),
            photo: field.image({ bn: 'ছবি বা স্ক্রিনশট', en: 'Photo or screenshot' }),
        },
    },
    preset: {
        blocks: [
            {
                name: { bn: 'কাস্টমারের নাম', en: 'Customer name' },
                text: { bn: 'কাস্টমার যা বলেছেন, এখানে লিখুন।', en: 'Write what the customer said here.' },
            },
            {
                name: { bn: 'কাস্টমারের নাম', en: 'Customer name' },
                text: { bn: 'কাস্টমার যা বলেছেন, এখানে লিখুন।', en: 'Write what the customer said here.' },
            },
            {
                name: { bn: 'কাস্টমারের নাম', en: 'Customer name' },
                text: { bn: 'কাস্টমার যা বলেছেন, এখানে লিখুন।', en: 'Write what the customer said here.' },
            },
        ],
    },
    style: { background: 'subtle' },
});

export const trustBadges = defineSection({
    type: 'trust-badges',
    version: 1,
    name: { bn: 'ভরসার চিহ্ন', en: 'Trust badges' },
    description: {
        bn: 'ক্যাশ অন ডেলিভারি, ফেরত, খাঁটি পণ্য: আইকন সহ ছোট ছোট কথা',
        en: 'Cash on delivery, returns, genuine products: short points with icons',
    },
    category: 'trust',
    icon: 'trust-badges',
    fields: {
        heading: heading(),
    },
    blocks: {
        label: { bn: 'চিহ্ন', en: 'Badge' },
        min: 1,
        max: 6,
        titleField: 'title',
        fields: {
            icon: field.select({ bn: 'আইকন', en: 'Icon' }, ICON_OPTIONS, 'check'),
            title: field.text(L.title, undefined, { max: 60 }),
            text: field.text(L.text, undefined, { max: 120 }),
        },
    },
    preset: {
        blocks: [
            {
                icon: 'cash',
                title: { bn: 'ক্যাশ অন ডেলিভারি', en: 'Cash on delivery' },
                text: { bn: 'পণ্য হাতে পেয়ে টাকা দিন', en: 'Pay when it reaches you' },
            },
            {
                icon: 'truck',
                title: { bn: 'সারা দেশে ডেলিভারি', en: 'Delivery all over Bangladesh' },
                text: { bn: '৬৪ জেলায়', en: 'To all 64 districts' },
            },
            {
                icon: 'return',
                title: { bn: 'সহজ রিটার্ন', en: 'Easy returns' },
                text: { bn: 'সমস্যা হলে ফেরত দিন', en: 'Return it if something’s wrong' },
            },
            {
                icon: 'shield',
                title: { bn: 'খাঁটি পণ্য', en: 'Genuine products' },
                text: { bn: 'যা দেখছেন, তা-ই পাবেন', en: 'What you see is what you get' },
            },
        ],
    },
    style: { spacing: 's' },
});

export const deliveryInfo = defineSection({
    type: 'delivery-info',
    version: 1,
    name: { bn: 'ডেলিভারির তথ্য', en: 'Delivery information' },
    description: {
        bn: 'এলাকা অনুযায়ী ডেলিভারি চার্জ আর সময়',
        en: 'Delivery charges and times by area',
    },
    category: 'trust',
    icon: 'delivery-info',
    fields: {
        heading: heading({ bn: 'ডেলিভারি চার্জ ও সময়', en: 'Delivery charges and times' }),
        note: text({
            bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি। পণ্য দেখে টাকা দিন।',
            en: 'Cash on delivery all over Bangladesh. Check your order before you pay.',
        }),
    },
    blocks: {
        label: { bn: 'এলাকা', en: 'Area' },
        min: 1,
        max: 4,
        titleField: 'area',
        fields: {
            area: field.text({ bn: 'এলাকা', en: 'Area' }, undefined, { max: 60 }),
            charge: field.text({ bn: 'চার্জ', en: 'Charge' }, undefined, { max: 40 }),
            time: field.text({ bn: 'সময়', en: 'Time' }, undefined, { max: 40 }),
        },
    },
    preset: {
        blocks: [
            {
                area: { bn: 'ঢাকার ভেতরে', en: 'Inside Dhaka' },
                charge: { bn: '৳৬০', en: '৳60' },
                time: { bn: '১–২ দিন', en: '1–2 days' },
            },
            {
                area: { bn: 'ঢাকার বাইরে', en: 'Outside Dhaka' },
                charge: { bn: '৳১২০', en: '৳120' },
                time: { bn: '২–৪ দিন', en: '2–4 days' },
            },
        ],
    },
});

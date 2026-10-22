import { defineSection } from '../define';
import { field } from '../fields';
import { buttonLabel, heading, ICON_OPTIONS, L, text } from './common';

/**
 * Sales page sections (roadmap phase 16). The hero, the packs and the order form only make sense
 * on a sales page, where the page's product and offers are known; the others work anywhere.
 */

const label = (en: string, bn: string) => ({ bn, en });
const SALES_ONLY = ['landing'] as const;

export const salesHero = defineSection({
    type: 'sales-hero',
    version: 1,
    name: label('Sales hero', 'সেলস হিরো'),
    description: label(
        'The top of a sales page: headline with a coloured second line, badge, photo or video, the offer and an order button',
        'সেলস পেজের শুরু: রঙিন দ্বিতীয় লাইনসহ শিরোনাম, ব্যাজ, ছবি বা ভিডিও, অফার আর অর্ডারের বাটন',
    ),
    category: 'intro',
    icon: 'sales-hero',
    layouts: SALES_ONLY,
    fields: {
        badge: field.text(label('Badge', 'ব্যাজ'), label('15% off', '১৫% ছাড়'), { max: 40 }),
        headline: field.text(
            L.heading,
            label('Pure, fresh and delivered to your door', 'খাঁটি, তাজা আর আপনার দরজায়'),
            {
                max: 160,
            },
        ),
        highlight: field.text(
            label('Second line (in the accent colour)', 'দ্বিতীয় লাইন (ব্র্যান্ডের রঙে)'),
            label('Cash on delivery all over Bangladesh', 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি'),
            { max: 160 },
        ),
        text: text(),
        media: field.select(
            label('Show', 'দেখান'),
            [
                { value: 'product', label: label("The product's photo", 'পণ্যের ছবি') },
                { value: 'image', label: label('Another image', 'অন্য ছবি') },
                { value: 'video', label: label('A video', 'ভিডিও') },
            ],
            'product',
        ),
        image: field.image(L.image, { when: { media: ['image'] } }),
        video: field.video(label('Video link', 'ভিডিওর লিংক'), { when: { media: ['video'] } }),
        offerBox: field.toggle(label('Show the price and saving', 'দাম আর কত সাশ্রয় দেখান'), true),
        button: buttonLabel(label('Order now', 'এখনই অর্ডার করুন')),
        points: field.textarea(
            label('Short points under the button, one per line', 'বাটনের নিচে ছোট কথা, প্রতি লাইনে একটি'),
            label(
                'Cash on delivery\nCheck before you pay\nDelivery all over Bangladesh',
                'ক্যাশ অন ডেলিভারি\nদেখে টাকা দিন\nসারা দেশে ডেলিভারি',
            ),
            { max: 400 },
        ),
    },
    style: { align: 'center', spacing: 'm' },
});

export const benefits = defineSection({
    type: 'benefits',
    version: 1,
    name: label('Benefits', 'সুবিধাগুলো'),
    description: label(
        '"What you get": a checklist or a grid with icons',
        '"যা পাচ্ছেন": টিক চিহ্নের তালিকা বা আইকনসহ গ্রিড',
    ),
    category: 'content',
    icon: 'benefits',
    fields: {
        heading: heading(label('What you get', 'যা পাচ্ছেন')),
        look: field.select(
            label('Look', 'দেখতে'),
            [
                { value: 'list', label: label('Checklist', 'তালিকা') },
                { value: 'grid', label: label('Grid', 'গ্রিড') },
            ],
            'list',
        ),
        columns: field.range(L.columns, { min: 1, max: 4 }, 2),
    },
    blocks: {
        label: label('Benefit', 'সুবিধা'),
        min: 1,
        max: 12,
        titleField: 'title',
        fields: {
            icon: field.select(label('Icon', 'আইকন'), ICON_OPTIONS, 'check'),
            title: field.text(L.title, undefined, { max: 120 }),
            text: field.textarea(L.text, undefined, { max: 300 }),
        },
    },
    preset: {
        blocks: [
            { title: label('100% genuine', '১০০% খাঁটি') },
            { title: label('No preservatives', 'কোনো প্রিজারভেটিভ নেই') },
            { title: label('Carefully packed', 'যত্ন করে প্যাক করা') },
            { title: label('Pay when it arrives', 'হাতে পেয়ে টাকা দিন') },
        ],
    },
});

export const specs = defineSection({
    type: 'specs',
    version: 1,
    name: label('Specifications or steps', 'বিবরণ বা ব্যবহারের নিয়ম'),
    description: label(
        'Label and value rows, or numbered "how to use" steps',
        'নাম আর মানের সারি, বা নম্বর দেওয়া ব্যবহারের ধাপ',
    ),
    category: 'content',
    icon: 'specs',
    fields: {
        heading: heading(label('Specifications', 'বিস্তারিত')),
        look: field.select(
            label('Look', 'দেখতে'),
            [
                { value: 'table', label: label('Table', 'টেবিল') },
                { value: 'steps', label: label('Numbered steps', 'নম্বর দেওয়া ধাপ') },
            ],
            'table',
        ),
    },
    blocks: {
        label: label('Row', 'সারি'),
        min: 1,
        max: 20,
        titleField: 'label',
        fields: {
            label: field.text(label('Label or step', 'নাম বা ধাপ'), undefined, { max: 120 }),
            value: field.textarea(label('Value or details', 'মান বা বিস্তারিত'), undefined, { max: 400 }),
        },
    },
    preset: {
        blocks: [
            { label: label('Weight', 'ওজন'), value: label('500 g', '৫০০ গ্রাম') },
            { label: label('Origin', 'উৎস'), value: label('Bangladesh', 'বাংলাদেশ') },
            { label: label('Shelf life', 'মেয়াদ'), value: label('12 months', '১২ মাস') },
        ],
    },
    style: { width: 'narrow' },
});

export const pricePacks = defineSection({
    type: 'price-packs',
    version: 1,
    name: label('Price and packs', 'দাম ও প্যাক'),
    description: label(
        "The page's packs: old price crossed out, the offer, how much is saved, the popular one marked",
        'পেজের প্যাকগুলো: আগের দাম কাটা, অফারের দাম, কত সাশ্রয়, জনপ্রিয়টি চিহ্নিত',
    ),
    category: 'products',
    icon: 'price-packs',
    layouts: SALES_ONLY,
    fields: {
        heading: heading(label('Choose your pack', 'আপনার প্যাক বেছে নিন')),
        text: text(),
        button: buttonLabel(label('Order this pack', 'এই প্যাক অর্ডার করুন')),
    },
    style: { align: 'center', background: 'subtle' },
});

export const comparison = defineSection({
    type: 'comparison',
    version: 1,
    name: label('Comparison', 'তুলনা'),
    description: label(
        '"Without / with" rows, with a cross and a tick',
        '"ছাড়া / সাথে" সারি, ক্রস আর টিক চিহ্নসহ',
    ),
    category: 'content',
    icon: 'comparison',
    fields: {
        heading: heading(label('Why it makes a difference', 'পার্থক্যটা কোথায়')),
        without: field.text(label('Left column title', 'বাঁ কলামের নাম'), label('Others', 'অন্যরা'), {
            max: 60,
        }),
        with: field.text(label('Right column title', 'ডান কলামের নাম'), label('Ours', 'আমাদের'), { max: 60 }),
    },
    blocks: {
        label: label('Row', 'সারি'),
        min: 1,
        max: 12,
        titleField: 'with',
        fields: {
            without: field.text(label('Without', 'ছাড়া'), undefined, { max: 160 }),
            with: field.text(label('With', 'সাথে'), undefined, { max: 160 }),
        },
    },
    preset: {
        blocks: [
            {
                without: label('Mixed with cheaper oil', 'সস্তা তেল মেশানো'),
                with: label('Nothing added', 'কিছু মেশানো নেই'),
            },
            {
                without: label('Unknown source', 'উৎস অজানা'),
                with: label('Straight from the farm', 'সরাসরি খামার থেকে'),
            },
            {
                without: label('Pay before you see it', 'দেখার আগে টাকা'),
                with: label('Pay when it arrives', 'হাতে পেয়ে টাকা'),
            },
        ],
    },
    style: { width: 'narrow' },
});

export const countdown = defineSection({
    type: 'countdown',
    version: 1,
    name: label('Countdown', 'কাউন্টডাউন'),
    description: label(
        'Time left on an offer: to a fixed date in Dhaka time, or the same few hours for each visitor',
        'অফারের বাকি সময়: ঢাকার সময়ে নির্দিষ্ট তারিখ পর্যন্ত, অথবা প্রতিটি ভিজিটরের জন্য কয়েক ঘণ্টা',
    ),
    category: 'intro',
    icon: 'countdown',
    fields: {
        heading: heading(label('The offer ends in', 'অফার শেষ হতে বাকি')),
        mode: field.select(
            label('Counts down to', 'কোন পর্যন্ত গণনা'),
            [
                { value: 'fixed', label: label('A date and time', 'একটি তারিখ ও সময়') },
                {
                    value: 'evergreen',
                    label: label('A few hours from each visit', 'প্রতিবার আসার পর কয়েক ঘণ্টা'),
                },
            ],
            'fixed',
        ),
        endsAt: field.datetime(label('Ends at (Dhaka time)', 'শেষ হবে (ঢাকার সময়)'), {
            when: { mode: ['fixed'] },
        }),
        hours: field.range(
            label('Hours for each visitor', 'প্রতি ভিজিটরের জন্য ঘণ্টা'),
            { min: 1, max: 72 },
            6,
            {
                when: { mode: ['evergreen'] },
            },
        ),
        expired: field.select(
            label('When it ends', 'শেষ হলে'),
            [
                { value: 'message', label: label('Show a message', 'একটি বার্তা দেখান') },
                { value: 'hide', label: label('Hide the section', 'সেকশন লুকান') },
            ],
            'message',
        ),
        expiredText: field.text(
            label('Message after the end', 'শেষ হওয়ার পরের বার্তা'),
            label('The offer has ended. Call us for today’s price.', 'অফার শেষ। আজকের দাম জানতে কল করুন।'),
            { max: 160, when: { expired: ['message'] } },
        ),
    },
    style: { align: 'center', background: 'accent' },
});

export const guarantee = defineSection({
    type: 'guarantee',
    version: 1,
    name: label('Guarantee', 'গ্যারান্টি'),
    description: label(
        'A promise with a seal or photo: money back, genuine product',
        'সিল বা ছবিসহ একটি প্রতিশ্রুতি: টাকা ফেরত, খাঁটি পণ্য',
    ),
    category: 'trust',
    icon: 'guarantee',
    fields: {
        image: field.image(label('Seal or photo', 'সিল বা ছবি')),
        heading: heading(label('Our promise', 'আমাদের প্রতিশ্রুতি')),
        text: field.textarea(
            L.text,
            label(
                'If the product isn’t as described, return it when it arrives and pay nothing.',
                'পণ্য বর্ণনার মতো না হলে হাতে পাওয়ার সময়ই ফেরত দিন, কোনো টাকা দিতে হবে না।',
            ),
            { max: 600 },
        ),
    },
    style: { width: 'narrow', align: 'center' },
});

export const orderForm = defineSection({
    type: 'order-form',
    version: 1,
    name: label('Order form', 'অর্ডার ফর্ম'),
    description: label(
        'The order form on the page: packs, the add-on offer, name, phone, address and payment, with the total on the button',
        'পেজেই অর্ডার ফর্ম: প্যাক, সাথে নেওয়ার অফার, নাম, ফোন, ঠিকানা আর পেমেন্ট, বাটনে মোট টাকা',
    ),
    category: 'products',
    icon: 'order-form',
    layouts: SALES_ONLY,
    fields: {
        heading: heading(label('Order now', 'অর্ডার করতে নিচের ফর্মটি পূরণ করুন')),
        text: text(label('Pay when the product reaches you.', 'পণ্য হাতে পেয়ে টাকা দিন।')),
        button: buttonLabel(label('Confirm order', 'অর্ডার কনফার্ম করুন')),
        showNote: field.toggle(label('Ask for a note', 'নোট লেখার ঘর দেখান'), true),
        help: field.toggle(
            label('Show "call or WhatsApp us" under the form', 'ফর্মের নিচে "কল বা হোয়াটসঅ্যাপ করুন" দেখান'),
            true,
        ),
    },
    style: { anchor: 'order', width: 'narrow', background: 'subtle' },
});

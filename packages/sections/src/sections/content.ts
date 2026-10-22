import { defineSection } from '../define';
import { field } from '../fields';
import { buttonLabel, heading, ICON_OPTIONS, L, text } from './common';

export const imageWithText = defineSection({
    type: 'image-with-text',
    version: 1,
    name: { bn: 'ছবি আর লেখা', en: 'Image with text' },
    description: {
        bn: 'এক পাশে ছবি, অন্য পাশে গল্প বা বিবরণ',
        en: 'An image on one side, your story or details on the other',
    },
    category: 'content',
    icon: 'image-with-text',
    fields: {
        image: field.image(L.image),
        imagePosition: field.select(
            { bn: 'ছবি', en: 'Image' },
            [
                { value: 'left', label: { bn: 'বাঁয়ে', en: 'Left' } },
                { value: 'right', label: { bn: 'ডানে', en: 'Right' } },
            ],
            'left',
        ),
        heading: heading({ bn: 'আমাদের গল্প', en: 'Our story' }),
        text: field.richText(L.text, {
            bn: '<p>আপনার ব্যবসার কথা, পণ্য কীভাবে তৈরি হয় বা কেন আপনার কাছ থেকে কিনবেন, তা এখানে লিখুন।</p>',
            en: '<p>Tell shoppers about your business, how your products are made, or why they should buy from you.</p>',
        }),
        button: buttonLabel(),
        link: field.link(L.buttonLink),
    },
});

export const richText = defineSection({
    type: 'rich-text',
    version: 1,
    name: { bn: 'লেখা', en: 'Rich text' },
    description: { bn: 'শিরোনাম, লেখা আর একটি বাটন', en: 'A heading, text and a button' },
    category: 'content',
    icon: 'rich-text',
    fields: {
        heading: heading({ bn: 'আমাদের সম্পর্কে', en: 'About us' }),
        text: field.richText(L.text, {
            bn: '<p>আপনার দোকান সম্পর্কে কয়েকটি কথা লিখুন।</p>',
            en: '<p>Write a few words about your store.</p>',
        }),
        button: buttonLabel(),
        link: field.link(L.buttonLink),
    },
    style: { width: 'narrow', align: 'center' },
});

export const multicolumn = defineSection({
    type: 'multicolumn',
    version: 1,
    name: { bn: 'কলাম', en: 'Columns' },
    description: {
        bn: 'পাশাপাশি কয়েকটি কলাম, প্রতিটিতে ছবি বা আইকন আর লেখা',
        en: 'Columns side by side, each with an image or icon and text',
    },
    category: 'content',
    icon: 'multicolumn',
    fields: {
        heading: heading({ bn: 'কেন আমাদের কাছ থেকে কিনবেন', en: 'Why buy from us' }),
        columns: field.range(L.columns, { min: 2, max: 4 }, 3),
    },
    blocks: {
        label: { bn: 'কলাম', en: 'Column' },
        min: 1,
        max: 6,
        titleField: 'title',
        fields: {
            image: field.image(L.image, {
                hint: { bn: 'ছবি না দিলে আইকন দেখাবে', en: 'Without an image, the icon shows' },
            }),
            icon: field.select({ bn: 'আইকন', en: 'Icon' }, ICON_OPTIONS, 'check'),
            title: field.text(L.title, undefined, { max: 80 }),
            text: field.textarea(L.text, undefined, { max: 300 }),
            link: field.link(L.link),
        },
    },
    preset: {
        blocks: [
            {
                icon: 'leaf',
                title: { bn: 'খাঁটি পণ্য', en: 'Genuine products' },
                text: { bn: 'যা দেখছেন, তা-ই পাবেন।', en: 'What you see is what you get.' },
            },
            {
                icon: 'truck',
                title: { bn: 'দ্রুত ডেলিভারি', en: 'Fast delivery' },
                text: { bn: 'সারা বাংলাদেশে।', en: 'All over Bangladesh.' },
            },
            {
                icon: 'chat',
                title: { bn: 'সাহায্য দরকার?', en: 'Need help?' },
                text: { bn: 'হোয়াটসঅ্যাপে মেসেজ দিন।', en: 'Message us on WhatsApp.' },
            },
        ],
    },
    style: { align: 'center' },
});

export const faq = defineSection({
    type: 'faq',
    version: 1,
    name: { bn: 'প্রশ্ন ও উত্তর', en: 'FAQ' },
    description: {
        bn: 'সাধারণ প্রশ্নগুলো; উত্তর খুলতে ট্যাপ করতে হয়',
        en: 'Common questions; shoppers tap to open an answer',
    },
    category: 'content',
    icon: 'faq',
    fields: {
        heading: heading({ bn: 'সাধারণ প্রশ্ন', en: 'Frequently asked questions' }),
        text: text(),
    },
    blocks: {
        label: { bn: 'প্রশ্ন', en: 'Question' },
        min: 1,
        max: 20,
        titleField: 'question',
        fields: {
            question: field.text({ bn: 'প্রশ্ন', en: 'Question' }, undefined, { max: 200 }),
            answer: field.textarea({ bn: 'উত্তর', en: 'Answer' }, undefined, { max: 1500 }),
        },
    },
    preset: {
        blocks: [
            {
                question: { bn: 'কীভাবে অর্ডার করব?', en: 'How do I order?' },
                answer: {
                    bn: 'পণ্য বেছে "অর্ডার করুন" চাপুন, নাম, ফোন নম্বর আর ঠিকানা দিন। আমরা ফোন করে কনফার্ম করব।',
                    en: 'Choose a product, tap "Order now" and give your name, phone number and address. We call to confirm.',
                },
            },
            {
                question: { bn: 'ক্যাশ অন ডেলিভারি আছে?', en: 'Can I pay cash on delivery?' },
                answer: {
                    bn: 'হ্যাঁ, পণ্য হাতে পেয়ে টাকা দিতে পারবেন।',
                    en: 'Yes, you pay when the order reaches you.',
                },
            },
            {
                question: { bn: 'ডেলিভারিতে কতদিন লাগে?', en: 'How long does delivery take?' },
                answer: {
                    bn: 'ঢাকার ভেতরে সাধারণত ১–২ দিন, ঢাকার বাইরে ২–৪ দিন।',
                    en: 'Usually 1–2 days inside Dhaka and 2–4 days outside Dhaka.',
                },
            },
        ],
    },
    style: { width: 'narrow' },
});

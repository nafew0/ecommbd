import { defineSection } from '../define';
import { field } from '../fields';
import { buttonLabel, heading, L, sizeOptions, text } from './common';

export const hero = defineSection({
    type: 'hero',
    version: 1,
    name: { bn: 'হিরো', en: 'Hero' },
    description: {
        bn: 'পেজের শুরুতে বড় ছবি, শিরোনাম আর বাটন',
        en: 'A large image with a heading and buttons, at the top of a page',
    },
    category: 'intro',
    icon: 'hero',
    fields: {
        image: field.image(L.image, {
            hint: { bn: 'চওড়া ছবি, অন্তত ১৬০০ পিক্সেল', en: 'A wide image, at least 1600 pixels' },
        }),
        phoneImage: field.image(L.phoneImage, {
            hint: { bn: 'ফোনে আলাদা (খাড়া) ছবি দেখাতে চাইলে', en: 'A different (tall) image for phones' },
        }),
        layout: field.select(
            { bn: 'লেআউট', en: 'Layout' },
            [
                { value: 'overlay', label: { bn: 'ছবির ওপর লেখা', en: 'Text on the image' } },
                { value: 'split', label: { bn: 'ছবির পাশে লেখা', en: 'Text beside the image' } },
            ],
            'overlay',
        ),
        height: field.select({ bn: 'উচ্চতা', en: 'Height' }, sizeOptions, 'm', {
            when: { layout: ['overlay'] },
        }),
        overlay: field.range({ bn: 'ছবির ওপর ছায়া', en: 'Image shade' }, { min: 0, max: 80, step: 10 }, 30, {
            hint: { bn: 'লেখা পড়তে সুবিধা হয়', en: 'Makes text on the image easier to read' },
            when: { layout: ['overlay'] },
        }),
        badge: field.text({ bn: 'ব্যাজ', en: 'Badge' }, undefined, {
            max: 40,
            hint: { bn: 'যেমন "১৫% ছাড়"', en: 'For example "15% off"' },
        }),
        heading: heading({ bn: 'নতুন কালেকশন এসেছে', en: 'The new collection is here' }),
        text: text({
            bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি। পণ্য দেখে টাকা দিন।',
            en: 'Cash on delivery all over Bangladesh. Check your order before you pay.',
        }),
        button: buttonLabel({ bn: 'এখনই কিনুন', en: 'Shop now' }),
        link: field.link(L.buttonLink, { type: 'search' }),
        secondButton: field.text({ bn: 'দ্বিতীয় বাটন', en: 'Second button' }, undefined, { max: 40 }),
        secondLink: field.link(
            { bn: 'দ্বিতীয় বাটনের লিংক', en: 'Second button link' },
            { type: 'whatsapp' },
        ),
    },
    style: { width: 'full', align: 'center' },
});

export const slideshow = defineSection({
    type: 'slideshow',
    version: 1,
    name: { bn: 'স্লাইডশো', en: 'Slideshow' },
    description: {
        bn: 'কয়েকটি ছবি একটার পর একটা, প্রতিটিতে লেখা আর বাটন',
        en: 'Several images one after another, each with text and a button',
    },
    category: 'intro',
    icon: 'slideshow',
    fields: {
        height: field.select({ bn: 'উচ্চতা', en: 'Height' }, sizeOptions, 'm'),
        overlay: field.range({ bn: 'ছবির ওপর ছায়া', en: 'Image shade' }, { min: 0, max: 80, step: 10 }, 30),
        autoplay: field.toggle({ bn: 'নিজে থেকে বদলাবে', en: 'Change slides automatically' }, false, {
            hint: {
                bn: 'প্রতি ৫ সেকেন্ডে; কেউ ছুঁলে বা কম নড়াচড়া চাইলে থামে',
                en: 'Every 5 seconds; stops when touched or for visitors who prefer less motion',
            },
        }),
    },
    blocks: {
        label: { bn: 'স্লাইড', en: 'Slide' },
        min: 1,
        max: 5,
        titleField: 'heading',
        fields: {
            image: field.image(L.image),
            phoneImage: field.image(L.phoneImage),
            heading: heading(),
            text: text(),
            button: buttonLabel(),
            link: field.link(L.buttonLink),
        },
    },
    preset: {
        blocks: [
            {
                heading: { bn: 'ঈদের নতুন কালেকশন', en: 'The new Eid collection' },
                button: { bn: 'দেখুন', en: 'Shop now' },
                link: { type: 'search' },
            },
            {
                heading: { bn: 'সারা দেশে ক্যাশ অন ডেলিভারি', en: 'Cash on delivery all over Bangladesh' },
                button: { bn: 'অর্ডার করুন', en: 'Order now' },
                link: { type: 'search' },
            },
        ],
    },
    style: { width: 'full', align: 'center' },
});

export const banner = defineSection({
    type: 'banner',
    version: 1,
    name: { bn: 'অফার ব্যানার', en: 'Offer banner' },
    description: {
        bn: 'অফার বা ঘোষণার জন্য রঙিন একটি অংশ, পাশে ছবি রাখা যায়',
        en: 'A coloured band for an offer or announcement, with an optional image',
    },
    category: 'intro',
    icon: 'banner',
    fields: {
        eyebrow: field.text(
            { bn: 'ছোট লেখা (ওপরে)', en: 'Small text (above)' },
            {
                bn: 'সীমিত সময়ের অফার',
                en: 'Limited-time offer',
            },
            { max: 60 },
        ),
        heading: heading({ bn: 'এই সপ্তাহের অফার দেখুন', en: 'See this week’s offers' }),
        text: text(),
        button: buttonLabel({ bn: 'অর্ডার করুন', en: 'Order now' }),
        link: field.link(L.buttonLink, { type: 'search' }),
        image: field.image(L.image),
    },
    style: { background: 'accent', align: 'center' },
});

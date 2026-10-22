import { defineSection } from '../define';
import { field } from '../fields';
import { heading, L } from './common';

export const imageGrid = defineSection({
    type: 'image-grid',
    version: 1,
    name: { bn: 'ছবির গ্যালারি', en: 'Image gallery' },
    description: {
        bn: 'কয়েকটি ছবি গ্রিডে, চাইলে প্রতিটিতে লেখা আর লিংক',
        en: 'Images in a grid, each with an optional caption and link',
    },
    category: 'media',
    icon: 'image-grid',
    fields: {
        heading: heading(),
        columns: field.range(L.columns, { min: 2, max: 4 }, 3),
        shape: field.select(
            { bn: 'ছবির আকার', en: 'Image shape' },
            [
                { value: 'square', label: { bn: 'বর্গ', en: 'Square' } },
                { value: 'portrait', label: { bn: 'খাড়া', en: 'Portrait' } },
                { value: 'landscape', label: { bn: 'আড়াআড়ি', en: 'Landscape' } },
                { value: 'natural', label: { bn: 'যেমন আছে', en: 'As uploaded' } },
            ],
            'square',
        ),
    },
    blocks: {
        label: { bn: 'ছবি', en: 'Image' },
        min: 1,
        max: 12,
        titleField: 'caption',
        fields: {
            image: field.image(L.image),
            caption: field.text({ bn: 'ক্যাপশন', en: 'Caption' }, undefined, { max: 120 }),
            link: field.link(L.link),
        },
    },
    preset: { blocks: [{}, {}, {}] },
});

export const video = defineSection({
    type: 'video',
    version: 1,
    name: { bn: 'ভিডিও', en: 'Video' },
    description: {
        bn: 'ইউটিউব বা ফেসবুকের ভিডিও; প্লে চাপলে তবেই লোড হয়, পেজ ধীর হয় না',
        en: 'A YouTube or Facebook video; it loads only when played, so the page stays fast',
    },
    category: 'media',
    icon: 'video',
    fields: {
        heading: heading(),
        video: field.video(
            { bn: 'ভিডিওর লিংক', en: 'Video link' },
            {
                hint: {
                    bn: 'ইউটিউব বা ফেসবুক ভিডিওর লিংক পেস্ট করুন',
                    en: 'Paste a YouTube or Facebook video link',
                },
            },
        ),
        poster: field.image(
            { bn: 'কভার ছবি', en: 'Cover image' },
            {
                hint: {
                    bn: 'ফেসবুক ভিডিওর জন্য দরকার; ইউটিউব নিজের ছবি দেয়',
                    en: 'Needed for Facebook videos; YouTube has its own',
                },
            },
        ),
        shape: field.select(
            { bn: 'ভিডিওর আকার', en: 'Video shape' },
            [
                { value: 'wide', label: { bn: 'আড়াআড়ি (১৬:৯)', en: 'Wide (16:9)' } },
                { value: 'tall', label: { bn: 'খাড়া (৯:১৬, রিল)', en: 'Tall (9:16, reels)' } },
                { value: 'square', label: { bn: 'বর্গ (১:১)', en: 'Square (1:1)' } },
            ],
            'wide',
        ),
        caption: field.text({ bn: 'ক্যাপশন', en: 'Caption' }, undefined, { max: 200 }),
    },
    style: { width: 'narrow', align: 'center' },
});

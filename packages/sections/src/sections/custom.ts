import { defineSection } from '../define';
import { field, type SelectOption } from '../fields';
import { ICON_OPTIONS, L } from './common';

/**
 * The Custom section (roadmap phase 16): columns of freely chosen elements, each with its own
 * look, for anything the ready-made sections don't do. Elements are the section's blocks: each
 * says which column it goes in, and the blocks' order is the order down each column.
 */

const label = (en: string, bn: string) => ({ bn, en });

export const ELEMENT_KINDS = [
    'heading',
    'text',
    'image',
    'button',
    'list',
    'iconbox',
    'video',
    'countdown',
    'price',
    'badge',
    'stars',
    'spacer',
    'divider',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

const KIND_LABELS: Record<ElementKind, ReturnType<typeof label>> = {
    heading: label('Heading', 'শিরোনাম'),
    text: label('Text', 'লেখা'),
    image: label('Image', 'ছবি'),
    button: label('Button', 'বাটন'),
    list: label('Checklist', 'টিক চিহ্নের তালিকা'),
    iconbox: label('Icon box', 'আইকন বক্স'),
    video: label('Video', 'ভিডিও'),
    countdown: label('Countdown', 'কাউন্টডাউন'),
    price: label('Price', 'দাম'),
    badge: label('Badge', 'ব্যাজ'),
    stars: label('Stars', 'তারা'),
    spacer: label('Space', 'ফাঁকা জায়গা'),
    divider: label('Line', 'দাগ'),
};

const KIND_OPTIONS: ReadonlyArray<SelectOption<ElementKind>> = ELEMENT_KINDS.map(value => ({
    value,
    label: KIND_LABELS[value],
}));

/** Layouts of the columns: equal or uneven widths. */
export const COLUMN_LAYOUTS = {
    '1': [1],
    '1-1': [1, 1],
    '1-2': [1, 2],
    '2-1': [2, 1],
    '1-1-1': [1, 1, 1],
    '1-2-1': [1, 2, 1],
    '1-1-1-1': [1, 1, 1, 1],
} as const;
export type ColumnLayout = keyof typeof COLUMN_LAYOUTS;

const styled = { when: { kind: ELEMENT_KINDS.filter(kind => kind !== 'spacer') } };
const textual = ['heading', 'text', 'button', 'list', 'iconbox', 'price', 'badge', 'countdown', 'stars'];

export const customSection = defineSection({
    type: 'custom',
    version: 1,
    name: label('Custom section', 'নিজের মতো সেকশন'),
    description: label(
        'Build your own: columns of headings, text, images, buttons, lists, video, countdown and more, each styled as you like',
        'নিজের মতো বানান: কলামে শিরোনাম, লেখা, ছবি, বাটন, তালিকা, ভিডিও, কাউন্টডাউন আর আরও অনেক কিছু, যেভাবে খুশি সাজিয়ে',
    ),
    category: 'layout',
    icon: 'custom',
    fields: {
        layout: field.select(
            label('Columns', 'কলাম'),
            [
                { value: '1', label: label('One', 'একটি') },
                { value: '1-1', label: label('Two equal', 'সমান দুটি') },
                { value: '1-2', label: label('Narrow + wide', 'সরু + চওড়া') },
                { value: '2-1', label: label('Wide + narrow', 'চওড়া + সরু') },
                { value: '1-1-1', label: label('Three', 'তিনটি') },
                { value: '1-2-1', label: label('Three, wide middle', 'তিনটি, মাঝেরটা চওড়া') },
                { value: '1-1-1-1', label: label('Four', 'চারটি') },
            ],
            '1-1',
        ),
        gap: field.range(
            label('Space between columns', 'কলামের মাঝে ফাঁকা'),
            { min: 0, max: 80, step: 4 },
            32,
        ),
        verticalAlign: field.select(
            label('Line up columns', 'কলাম সাজানো'),
            [
                { value: 'start', label: label('Top', 'ওপরে') },
                { value: 'center', label: label('Middle', 'মাঝে') },
                { value: 'end', label: label('Bottom', 'নিচে') },
            ],
            'center',
        ),
        phoneOrder: field.select(
            label('On phones', 'ফোনে'),
            [
                { value: 'normal', label: label('First column on top', 'প্রথম কলাম ওপরে') },
                { value: 'reverse', label: label('Last column on top', 'শেষ কলাম ওপরে') },
            ],
            'normal',
        ),
    },
    blocks: {
        label: label('Element', 'এলিমেন্ট'),
        min: 1,
        max: 40,
        titleField: 'heading',
        fields: {
            kind: field.select(label('Type', 'ধরন'), KIND_OPTIONS, 'heading'),
            column: field.select(
                label('Column', 'কলাম'),
                [
                    { value: '1', label: label('1', '১') },
                    { value: '2', label: label('2', '২') },
                    { value: '3', label: label('3', '৩') },
                    { value: '4', label: label('4', '৪') },
                ],
                '1',
            ),
            heading: field.text(L.heading, undefined, { max: 200, when: { kind: ['heading', 'iconbox'] } }),
            tag: field.select(
                label('Heading level', 'শিরোনামের স্তর'),
                [
                    { value: 'h2', label: label('Main (H2)', 'প্রধান (H2)') },
                    { value: 'h3', label: label('Sub (H3)', 'ছোট (H3)') },
                    { value: 'p', label: label('Not a heading', 'শিরোনাম নয়') },
                ],
                'h2',
                { when: { kind: ['heading'] } },
            ),
            text: field.richText(L.text, undefined, { max: 10_000, when: { kind: ['text'] } }),
            body: field.textarea(L.text, undefined, { max: 600, when: { kind: ['iconbox'] } }),
            items: field.textarea(label('Items, one per line', 'প্রতি লাইনে একটি'), undefined, {
                max: 2000,
                when: { kind: ['list'] },
            }),
            image: field.image(L.image, { when: { kind: ['image', 'iconbox'] } }),
            label: field.text(label('Label', 'লেখা'), undefined, {
                max: 80,
                when: { kind: ['button', 'badge'] },
            }),
            link: field.link(L.link, { type: 'none' }, { when: { kind: ['button', 'image'] } }),
            look: field.select(
                label('Look', 'দেখতে'),
                [
                    { value: 'solid', label: label('Solid', 'ভরাট') },
                    { value: 'outline', label: label('Outline', 'শুধু বর্ডার') },
                    { value: 'link', label: label('Text link', 'লিংকের মতো') },
                ],
                'solid',
                { when: { kind: ['button'] } },
            ),
            icon: field.select(label('Icon', 'আইকন'), ICON_OPTIONS, 'check', {
                when: { kind: ['list', 'iconbox'] },
            }),
            video: field.video(label('Video link', 'ভিডিওর লিংক'), { when: { kind: ['video'] } }),
            endsAt: field.datetime(label('Ends at (Dhaka time)', 'শেষ হবে (ঢাকার সময়)'), {
                when: { kind: ['countdown'] },
            }),
            price: field.money(label('Price', 'দাম'), { when: { kind: ['price'] } }),
            oldPrice: field.money(label('Old price (crossed out)', 'আগের দাম (কাটা)'), {
                when: { kind: ['price'] },
            }),
            rating: field.range(label('Stars', 'তারা'), { min: 0, max: 5 }, 5, { when: { kind: ['stars'] } }),
            height: field.range(label('Height', 'উচ্চতা'), { min: 4, max: 240, step: 4 }, 32, {
                when: { kind: ['spacer'] },
            }),
            // Each element's own look.
            color: field.hex(label('Colour', 'রং'), styled),
            background: field.hex(label('Background', 'ব্যাকগ্রাউন্ড'), styled),
            size: field.size(label('Size', 'মাপ'), { min: 10, max: 120 }, { when: { kind: textual } }),
            sizePhone: field.size(
                label('Size on phones', 'ফোনে মাপ'),
                { min: 10, max: 72 },
                { when: { kind: textual } },
            ),
            weight: field.select(
                label('Weight', 'মোটা-চিকন'),
                [
                    { value: '', label: label('Default', 'স্বাভাবিক') },
                    { value: '400', label: label('Regular', 'সাধারণ') },
                    { value: '600', label: label('Semi-bold', 'একটু মোটা') },
                    { value: '700', label: label('Bold', 'মোটা') },
                    { value: '800', label: label('Extra bold', 'খুব মোটা') },
                ],
                '',
                { when: { kind: textual } },
            ),
            align: field.select(
                label('Alignment', 'অবস্থান'),
                [
                    { value: '', label: label('As the section', 'সেকশন অনুযায়ী') },
                    { value: 'start', label: label('Left', 'বাঁয়ে') },
                    { value: 'center', label: label('Centre', 'মাঝে') },
                    { value: 'end', label: label('Right', 'ডানে') },
                ],
                '',
                styled,
            ),
            width: field.size(label('Width', 'চওড়া'), { min: 10, max: 100, step: 5, unit: '%' }, styled),
            padding: field.size(label('Inner space', 'ভেতরের ফাঁকা'), { min: 0, max: 80, step: 2 }, styled),
            radius: field.size(label('Corners', 'কোনা'), { min: 0, max: 40 }, styled),
            borderWidth: field.size(label('Border', 'বর্ডার'), { min: 0, max: 8 }, styled),
            borderColor: field.hex(label('Border colour', 'বর্ডারের রং'), styled),
            spaceBelow: field.size(label('Space below', 'নিচে ফাঁকা'), { min: 0, max: 160, step: 4 }, styled),
        },
    },
    preset: {
        settings: { layout: '1-1' },
        blocks: [
            { kind: 'image', column: '1' },
            {
                kind: 'heading',
                column: '2',
                heading: label('Write your heading', 'আপনার শিরোনাম লিখুন'),
            },
            {
                kind: 'text',
                column: '2',
                text: label(
                    '<p>Add text, buttons, lists or anything else, and style each one.</p>',
                    '<p>লেখা, বাটন, তালিকা বা অন্য যেকোনো কিছু যোগ করুন, আর প্রতিটি নিজের মতো সাজান।</p>',
                ),
            },
            {
                kind: 'button',
                column: '2',
                label: label('Order now', 'এখনই অর্ডার করুন'),
                link: { type: 'anchor', anchor: 'order' },
            },
        ],
    },
});

import { field, type Fields } from './fields';
import { ICON_OPTIONS, L } from './sections/common';
import type { Bilingual } from './text';

/**
 * The elements a page's tree is made of (roadmap phase 56): the container, which lays out what's
 * inside it, and the things a merchant puts in containers. Each element has a schema like a
 * section's (fields with defaults and checks), a version, and migrations between versions.
 */

const label = (en: string, bn: string): Bilingual => ({ bn, en });

/** Groups in the editor's "Add element" list. */
export const ELEMENT_CATEGORIES = ['layout', 'basic', 'media', 'sales'] as const;
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number];

/** Turns version n's stored props into version n + 1's. */
export type ElementMigration = (props: Record<string, unknown>) => Record<string, unknown>;

export interface ElementDefinition<Fs extends Fields = Fields> {
    type: string;
    /** Raised whenever the stored shape changes, with a migration from the previous version. */
    version: number;
    name: Bilingual;
    description: Bilingual;
    category: ElementCategory;
    fields: Fs;
    /** The field whose text names the element in the editor's tree. */
    titleField?: string;
    /** `migrations[n]` upgrades version n's props to version n + 1. */
    migrations?: Readonly<Record<number, ElementMigration>>;
    /** Props a newly added element starts with (the fields' defaults otherwise). */
    preset?: Record<string, unknown>;
    /** Made by the editor (opening a section up), not picked from the list. */
    internal?: boolean;
}

function defineElement<const Fs extends Fields>(definition: ElementDefinition<Fs>): ElementDefinition<Fs> {
    return definition;
}

/** How a grid container divides its width: equal or uneven columns. */
export const COLUMN_TEMPLATES = {
    '1': [1],
    '1-1': [1, 1],
    '1-1-1': [1, 1, 1],
    '1-1-1-1': [1, 1, 1, 1],
    '2-1': [2, 1],
    '1-2': [1, 2],
    '1-2-1': [1, 2, 1],
} as const;
export type ColumnTemplate = keyof typeof COLUMN_TEMPLATES;

const whenFlex = { when: { mode: ['flex'] } };
const whenGrid = { when: { mode: ['grid'] } };

export const container = defineElement({
    type: 'container',
    version: 1,
    name: label('Container', 'কনটেইনার'),
    description: label(
        'A box that lays out what you put in it, in a row, a column or a grid',
        'একটি বাক্স, যার ভেতরের জিনিস সারি, কলাম বা গ্রিডে সাজানো হয়',
    ),
    category: 'layout',
    fields: {
        mode: field.select(
            label('Layout', 'লেআউট'),
            [
                { value: 'flex', label: label('Flexible', 'ফ্লেক্স') },
                { value: 'grid', label: label('Grid', 'গ্রিড') },
            ],
            'flex',
        ),
        direction: field.select(
            label('Direction', 'দিক'),
            [
                { value: 'column', label: label('Down', 'ওপর থেকে নিচে') },
                { value: 'row', label: label('Across', 'পাশাপাশি') },
                { value: 'column-reverse', label: label('Up', 'নিচ থেকে ওপরে') },
                { value: 'row-reverse', label: label('Across, reversed', 'পাশাপাশি, উল্টো') },
            ],
            'column',
            whenFlex,
        ),
        columns: field.select(
            label('Columns', 'কলাম'),
            [
                { value: '1', label: label('One', 'একটি') },
                { value: '1-1', label: label('Two equal', 'সমান দুটি') },
                { value: '1-1-1', label: label('Three', 'তিনটি') },
                { value: '1-1-1-1', label: label('Four', 'চারটি') },
                { value: '2-1', label: label('Wide + narrow', 'চওড়া + সরু') },
                { value: '1-2', label: label('Narrow + wide', 'সরু + চওড়া') },
                { value: '1-2-1', label: label('Three, wide middle', 'তিনটি, মাঝেরটা চওড়া') },
            ],
            '1-1',
            whenGrid,
        ),
        gap: field.range(label('Space between', 'মাঝে ফাঁকা'), { min: 0, max: 80, step: 4 }, 16),
        rowGap: field.size(
            label('Space between rows', 'সারির মাঝে ফাঁকা'),
            { min: 0, max: 80, step: 4 },
            {
                hint: label('Empty: the same as the space between', 'খালি রাখলে মাঝের ফাঁকার সমান'),
                when: { mode: ['grid'] },
            },
        ),
        justify: field.select(
            label('Spread', 'ছড়ানো'),
            [
                { value: 'start', label: label('Start', 'শুরুতে') },
                { value: 'center', label: label('Centre', 'মাঝে') },
                { value: 'end', label: label('End', 'শেষে') },
                { value: 'space-between', label: label('Space between', 'মাঝে ফাঁকা রেখে') },
                { value: 'space-around', label: label('Space around', 'চারপাশে ফাঁকা রেখে') },
                { value: 'space-evenly', label: label('Even space', 'সমান ফাঁকা রেখে') },
            ],
            'start',
            whenFlex,
        ),
        align: field.select(
            label('Line up', 'সারিবদ্ধ'),
            [
                { value: 'stretch', label: label('Stretch', 'টেনে') },
                { value: 'start', label: label('Start', 'শুরুতে') },
                { value: 'center', label: label('Middle', 'মাঝে') },
                { value: 'end', label: label('End', 'শেষে') },
            ],
            'stretch',
        ),
        wrap: field.toggle(label('Wrap onto new lines', 'জায়গা না হলে নিচে নামান'), false, {
            when: { mode: ['flex'], direction: ['row', 'row-reverse'] },
        }),
        stack: field.toggle(label('Stack on phones', 'ফোনে একটির নিচে আরেকটি'), true, {
            hint: label(
                'Side-by-side columns become one column on phones',
                'পাশাপাশি কলাম ফোনে এক কলাম হয়ে যায়',
            ),
        }),
        phoneOrder: field.select(
            label('On phones', 'ফোনে'),
            [
                { value: 'normal', label: label('First on top', 'প্রথমটা ওপরে') },
                { value: 'reverse', label: label('Last on top', 'শেষেরটা ওপরে') },
            ],
            'normal',
            { when: { stack: [true] } },
        ),
        image: field.image(label('Background image', 'ব্যাকগ্রাউন্ডের ছবি'), {
            hint: label(
                'Fills the container, behind what is in it',
                'পুরো কনটেইনার জুড়ে থাকে, ভেতরের জিনিসের পেছনে',
            ),
        }),
        shade: field.range(label('Image shade', 'ছবির ওপর ছায়া'), { min: 0, max: 80, step: 10 }, 0, {
            hint: label('Makes text on the image easier to read', 'ছবির ওপরের লেখা পড়তে সুবিধা হয়'),
        }),
    },
});

export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;
export type HeadingTag = (typeof HEADING_TAGS)[number];

export const headingElement = defineElement({
    type: 'heading',
    version: 1,
    name: label('Heading', 'শিরোনাম'),
    description: label('A title, from H1 to H6', 'একটি শিরোনাম, H1 থেকে H6'),
    category: 'basic',
    titleField: 'text',
    fields: {
        text: field.text(L.heading, undefined, { max: 200 }),
        tag: field.select(
            label('Heading level', 'শিরোনামের স্তর'),
            [
                { value: 'h1', label: label('Page title (H1)', 'পেজের শিরোনাম (H1)') },
                { value: 'h2', label: label('Main (H2)', 'প্রধান (H2)') },
                { value: 'h3', label: label('Sub (H3)', 'ছোট (H3)') },
                { value: 'h4', label: label('H4', 'H4') },
                { value: 'h5', label: label('H5', 'H5') },
                { value: 'h6', label: label('H6', 'H6') },
                { value: 'p', label: label('Not a heading', 'শিরোনাম নয়') },
            ],
            'h2',
        ),
    },
    preset: { text: label('Write your heading', 'আপনার শিরোনাম লিখুন') },
});

export const textElement = defineElement({
    type: 'text',
    version: 1,
    name: label('Text', 'লেখা'),
    description: label('A paragraph, with bold, lists and links', 'অনুচ্ছেদ, সাথে বোল্ড, তালিকা আর লিংক'),
    category: 'basic',
    titleField: 'text',
    fields: {
        text: field.richText(L.text, undefined, { max: 10_000 }),
    },
    preset: {
        text: label('<p>Write your text here.</p>', '<p>এখানে আপনার লেখা লিখুন।</p>'),
    },
});

export const buttonElement = defineElement({
    type: 'button',
    version: 1,
    name: label('Button', 'বাটন'),
    description: label(
        'A button that goes to a page or a section',
        'একটি বাটন, যা কোনো পেজ বা সেকশনে নিয়ে যায়',
    ),
    category: 'basic',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), undefined, { max: 80 }),
        link: field.link(L.link, { type: 'none' }),
        look: field.select(
            label('Look', 'দেখতে'),
            [
                { value: 'solid', label: label('Solid', 'ভরাট') },
                { value: 'outline', label: label('Outline', 'শুধু বর্ডার') },
                { value: 'link', label: label('Text link', 'লিংকের মতো') },
            ],
            'solid',
        ),
    },
    preset: { label: label('Shop now', 'এখনই কিনুন'), link: { type: 'search' } },
});

export const imageElement = defineElement({
    type: 'image',
    version: 1,
    name: label('Image', 'ছবি'),
    description: label('A photo, with an optional link', 'একটি ছবি, চাইলে লিংকসহ'),
    category: 'basic',
    fields: {
        image: field.image(L.image),
        alt: field.text(label('Description for screen readers', 'স্ক্রিন রিডারের জন্য বর্ণনা'), undefined, {
            max: 200,
            hint: label(
                'Say what the photo shows. Leave empty for decoration',
                'ছবিতে কী আছে লিখুন। শুধু সাজানোর ছবি হলে খালি রাখুন',
            ),
        }),
        link: field.link(L.link, { type: 'none' }),
    },
});

export const iconElement = defineElement({
    type: 'icon',
    version: 1,
    name: label('Icon', 'আইকন'),
    description: label('One small drawing from our set', 'আমাদের সেট থেকে একটি ছোট আইকন'),
    category: 'basic',
    fields: {
        icon: field.select(label('Icon', 'আইকন'), ICON_OPTIONS, 'check'),
        size: field.range(label('Size', 'মাপ'), { min: 16, max: 96, step: 4 }, 32),
    },
});

export const spacerElement = defineElement({
    type: 'spacer',
    version: 1,
    name: label('Space', 'ফাঁকা জায়গা'),
    description: label('Empty room between two things', 'দুটি জিনিসের মাঝে ফাঁকা জায়গা'),
    category: 'basic',
    fields: {
        height: field.range(label('Height', 'উচ্চতা'), { min: 4, max: 240, step: 4 }, 32),
    },
});

export const dividerElement = defineElement({
    type: 'divider',
    version: 1,
    name: label('Line', 'দাগ'),
    description: label('A thin line across', 'আড়াআড়ি একটি সরু দাগ'),
    category: 'basic',
    fields: {},
});

export const listElement = defineElement({
    type: 'list',
    version: 1,
    name: label('List', 'তালিকা'),
    description: label('Points with bullets or numbers', 'বুলেট বা নম্বর দেওয়া পয়েন্ট'),
    category: 'basic',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Items, one per line', 'প্রতি লাইনে একটি'), undefined, { max: 2000 }),
        marker: field.select(
            label('Marker', 'চিহ্ন'),
            [
                { value: 'bullet', label: label('Bullets', 'বুলেট') },
                { value: 'number', label: label('Numbers', 'নম্বর') },
            ],
            'bullet',
        ),
    },
    preset: {
        items: label(
            'First point\nSecond point\nThird point',
            'প্রথম পয়েন্ট\nদ্বিতীয় পয়েন্ট\nতৃতীয় পয়েন্ট',
        ),
    },
});

export const iconListElement = defineElement({
    type: 'icon-list',
    version: 1,
    name: label('Checklist', 'টিক চিহ্নের তালিকা'),
    description: label('Points with an icon before each', 'প্রতিটি পয়েন্টের আগে একটি আইকন'),
    category: 'basic',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Items, one per line', 'প্রতি লাইনে একটি'), undefined, { max: 2000 }),
        icon: field.select(label('Icon', 'আইকন'), ICON_OPTIONS, 'check'),
    },
    preset: {
        items: label(
            'Cash on delivery\nDelivery all over Bangladesh\nEasy returns',
            'ক্যাশ অন ডেলিভারি\nসারা বাংলাদেশে ডেলিভারি\nসহজ রিটার্ন',
        ),
    },
});

export const badgeElement = defineElement({
    type: 'badge',
    version: 1,
    name: label('Badge', 'ব্যাজ'),
    description: label('A short label, like "15% off"', 'ছোট একটি লেবেল, যেমন "১৫% ছাড়"'),
    category: 'basic',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), undefined, { max: 80 }),
    },
    preset: { label: label('New', 'নতুন') },
});

export const quoteElement = defineElement({
    type: 'quote',
    version: 1,
    name: label('Quote', 'উক্তি'),
    description: label("Someone's words, with their name", 'কারও কথা, তার নামসহ'),
    category: 'basic',
    titleField: 'text',
    fields: {
        text: field.textarea(label('Quote', 'উক্তি'), undefined, { max: 600 }),
        author: field.text(label('Who said it', 'কে বলেছেন'), undefined, { max: 80 }),
    },
    preset: {
        text: label('The product is just as shown. Very happy.', 'পণ্য একদম ছবির মতো। খুব খুশি।'),
    },
});

export const iconBoxElement = defineElement({
    type: 'icon-box',
    version: 1,
    name: label('Icon box', 'আইকন বক্স'),
    description: label(
        'An icon or small image with a title and text',
        'একটি আইকন বা ছোট ছবি, শিরোনাম আর লেখা',
    ),
    category: 'basic',
    titleField: 'heading',
    fields: {
        icon: field.select(label('Icon', 'আইকন'), ICON_OPTIONS, 'check'),
        image: field.image(label('Image instead of the icon', 'আইকনের বদলে ছবি')),
        heading: field.text(L.heading, undefined, { max: 200 }),
        body: field.textarea(L.text, undefined, { max: 600 }),
    },
    preset: {
        icon: 'truck',
        heading: label('Fast delivery', 'দ্রুত ডেলিভারি'),
        body: label('All over Bangladesh in 2 to 5 days.', 'সারা বাংলাদেশে ২ থেকে ৫ দিনে।'),
    },
});

export const videoElement = defineElement({
    type: 'video',
    version: 1,
    name: label('Video', 'ভিডিও'),
    description: label(
        'A YouTube or Facebook video that loads when played',
        'ইউটিউব বা ফেসবুকের ভিডিও, চালালে তবেই লোড হয়',
    ),
    category: 'media',
    fields: {
        video: field.video(label('Video link', 'ভিডিওর লিংক')),
        title: field.text(label('Title', 'শিরোনাম'), undefined, { max: 200 }),
    },
});

export const countdownElement = defineElement({
    type: 'countdown',
    version: 1,
    name: label('Countdown', 'কাউন্টডাউন'),
    description: label('A clock counting down to the end of an offer', 'অফার শেষ হওয়ার সময় গোনা ঘড়ি'),
    category: 'sales',
    fields: {
        endsAt: field.datetime(label('Ends at (Dhaka time)', 'শেষ হবে (ঢাকার সময়)')),
    },
});

export const priceElement = defineElement({
    type: 'price',
    version: 1,
    name: label('Price', 'দাম'),
    description: label('A price, with the old price crossed out', 'একটি দাম, সাথে কাটা আগের দাম'),
    category: 'sales',
    fields: {
        price: field.money(label('Price', 'দাম')),
        oldPrice: field.money(label('Old price (crossed out)', 'আগের দাম (কাটা)')),
    },
});

export const starsElement = defineElement({
    type: 'stars',
    version: 1,
    name: label('Stars', 'তারা'),
    description: label('A rating out of five', 'পাঁচের মধ্যে রেটিং'),
    category: 'sales',
    fields: {
        rating: field.range(label('Stars', 'তারা'), { min: 0, max: 5 }, 5),
    },
});

/**
 * A ready-made section placed inside a container: its data stays live (products, the order form)
 * and its own settings stay as they were. Made when a section is opened up.
 */
export const liveElement = defineElement({
    type: 'live',
    version: 1,
    name: label('Live block', 'লাইভ ব্লক'),
    description: label(
        'A ready-made block that shows live data, like products or the order form',
        'তৈরি ব্লক, যা পণ্য বা অর্ডার ফর্মের মতো লাইভ তথ্য দেখায়',
    ),
    category: 'sales',
    fields: {},
    internal: true,
});

/** Every element, in the order the editor lists them. */
export const ELEMENTS: readonly ElementDefinition[] = [
    container,
    headingElement,
    textElement,
    buttonElement,
    imageElement,
    iconElement,
    listElement,
    iconListElement,
    iconBoxElement,
    badgeElement,
    quoteElement,
    dividerElement,
    spacerElement,
    videoElement,
    countdownElement,
    priceElement,
    starsElement,
    liveElement,
];

const BY_TYPE = new Map(ELEMENTS.map(definition => [definition.type, definition]));

export function elementDefinition(type: string): ElementDefinition | undefined {
    return BY_TYPE.get(type);
}

/** Layouts the editor offers when adding a container: how it starts, in one click. */
export const STRUCTURE_PRESETS = [
    { key: 'grid-1', mode: 'grid', columns: '1', cells: 1 },
    { key: 'grid-2', mode: 'grid', columns: '1-1', cells: 2 },
    { key: 'grid-3', mode: 'grid', columns: '1-1-1', cells: 3 },
    { key: 'grid-4', mode: 'grid', columns: '1-1-1-1', cells: 4 },
    { key: 'grid-2-1', mode: 'grid', columns: '2-1', cells: 2 },
    { key: 'grid-1-2', mode: 'grid', columns: '1-2', cells: 2 },
    { key: 'flex-2', mode: 'flex', direction: 'row', cells: 2 },
    { key: 'flex-3', mode: 'flex', direction: 'row', cells: 3 },
    { key: 'flex-4', mode: 'flex', direction: 'row', cells: 4 },
    { key: 'flex-column', mode: 'flex', direction: 'column', cells: 0 },
] as const;
export type StructurePreset = (typeof STRUCTURE_PRESETS)[number];

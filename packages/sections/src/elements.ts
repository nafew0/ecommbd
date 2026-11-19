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
export const ELEMENT_CATEGORIES = [
    'layout',
    'basic',
    'promotion',
    'products',
    'media',
    'trust',
    'store',
] as const;
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
    category: 'trust',
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
    category: 'promotion',
    fields: {
        endsAt: field.datetime(label('Ends at (Dhaka time)', 'শেষ হবে (ঢাকার সময়)')),
    },
});

export const priceElement = defineElement({
    type: 'price',
    version: 1,
    name: label('Price', 'দাম'),
    description: label('A price, with the old price crossed out', 'একটি দাম, সাথে কাটা আগের দাম'),
    category: 'products',
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
    category: 'trust',
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
    category: 'basic',
    fields: {},
    internal: true,
});

// Phase 61: the rest of the library. Elements with several items take them one per line, with
// " | " between an item's parts ("Question | Answer"), so they need no list editor.

const rowsHint = (en: string, bn: string) => label(`One per line: ${en}`, `প্রতি লাইনে একটি: ${bn}`);

/** Lines of an element's textarea, each split at " | " into its parts. */
export function parseRows(text: string, parts = 2): string[][] {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const cells = line.split('|').map(cell => cell.trim());
            // Extra bars belong to the last part ("a | b | c" with two parts is "a", "b | c").
            return [...cells.slice(0, parts - 1), cells.slice(parts - 1).join(' | ')];
        });
}

const images = (count: number) =>
    Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
            `image${index + 1}`,
            field.image(label(`Image ${index + 1}`, `ছবি ${'১২৩৪৫৬৭৮'[index]}`)),
        ]),
    );

const shape = field.select(
    label('Shape', 'আকৃতি'),
    [
        { value: 'square', label: label('Square', 'বর্গাকার') },
        { value: 'portrait', label: label('Portrait', 'খাড়া') },
        { value: 'landscape', label: label('Landscape', 'আড়াআড়ি') },
        { value: 'natural', label: label('As the photo', 'ছবির নিজের মাপ') },
    ],
    'square',
);

const buttonLook = field.select(
    label('Look', 'দেখতে'),
    [
        { value: 'solid', label: label('Solid', 'ভরাট') },
        { value: 'outline', label: label('Outline', 'শুধু বর্ডার') },
        { value: 'link', label: label('Text link', 'লিংকের মতো') },
    ],
    'solid',
);

export const sectionTitleElement = defineElement({
    type: 'section-title',
    version: 1,
    name: label('Section title', 'সেকশনের শিরোনাম'),
    description: label(
        'A small line, a heading and a sentence, together',
        'ছোট একটি লাইন, শিরোনাম আর একটি বাক্য, একসাথে',
    ),
    category: 'basic',
    titleField: 'heading',
    fields: {
        eyebrow: field.text(label('Small line above', 'ওপরের ছোট লাইন'), undefined, { max: 60 }),
        heading: field.text(L.heading, undefined, { max: 200 }),
        text: field.textarea(L.text, undefined, { max: 400 }),
    },
    preset: {
        eyebrow: label('New this week', 'এই সপ্তাহে নতুন'),
        heading: label('Write your heading', 'আপনার শিরোনাম লিখুন'),
        text: label('One sentence that says more.', 'এক বাক্যে আরেকটু বলুন।'),
    },
});

export const toggleElement = defineElement({
    type: 'toggle',
    version: 1,
    name: label('Toggle', 'খোলা-বন্ধ লেখা'),
    description: label('A question that opens to show its answer', 'একটি প্রশ্ন, চাপলে উত্তর খোলে'),
    category: 'basic',
    titleField: 'question',
    fields: {
        question: field.text(label('Question', 'প্রশ্ন'), undefined, { max: 200 }),
        answer: field.textarea(label('Answer', 'উত্তর'), undefined, { max: 1200 }),
        open: field.toggle(label('Start open', 'শুরুতে খোলা'), false),
    },
    preset: {
        question: label('How long does delivery take?', 'ডেলিভারিতে কতদিন লাগে?'),
        answer: label('1–2 days inside Dhaka, 2–4 days outside.', 'ঢাকার ভেতরে ১–২ দিন, বাইরে ২–৪ দিন।'),
    },
});

export const accordionElement = defineElement({
    type: 'accordion',
    version: 1,
    name: label('Accordion', 'অ্যাকর্ডিয়ন'),
    description: label('Questions that open one at a time', 'কয়েকটি প্রশ্ন, একবারে একটি খোলে'),
    category: 'promotion',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Questions and answers', 'প্রশ্ন ও উত্তর'), undefined, {
            max: 6000,
            hint: rowsHint('Question | Answer', 'প্রশ্ন | উত্তর'),
        }),
        single: field.toggle(label('Only one open at a time', 'একবারে একটিই খোলা'), true),
    },
    preset: {
        items: label(
            'How do I order? | Choose a product, press "Buy now" and give your name, number and address.\nWhen do I pay? | When the product reaches you, after you check it.\nCan I return it? | Yes, within 3 days if something is wrong.',
            'কীভাবে অর্ডার করব? | পণ্য বেছে "এখনই কিনুন" চাপুন, তারপর নাম, নম্বর আর ঠিকানা দিন।\nটাকা কখন দেব? | পণ্য হাতে পেয়ে, দেখে তারপর।\nফেরত দেওয়া যায়? | হ্যাঁ, সমস্যা হলে ৩ দিনের মধ্যে।',
        ),
    },
});

export const tabsElement = defineElement({
    type: 'tabs',
    version: 1,
    name: label('Tabs', 'ট্যাব'),
    description: label('Up to six tabs, each with its own text', 'ছয়টি পর্যন্ত ট্যাব, প্রতিটিতে আলাদা লেখা'),
    category: 'promotion',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Tabs', 'ট্যাব'), undefined, {
            max: 6000,
            hint: rowsHint('Tab name | Text', 'ট্যাবের নাম | লেখা'),
        }),
    },
    preset: {
        items: label(
            'Details | What it is made of and how it is made.\nDelivery | All over Bangladesh in 2 to 4 days.\nReturns | Within 3 days if something is wrong.',
            'বিবরণ | কী দিয়ে তৈরি আর কীভাবে তৈরি।\nডেলিভারি | সারা বাংলাদেশে ২ থেকে ৪ দিনে।\nরিটার্ন | সমস্যা হলে ৩ দিনের মধ্যে।',
        ),
    },
});

export const noticeElement = defineElement({
    type: 'notice',
    version: 1,
    name: label('Notice box', 'নোটিশ বক্স'),
    description: label('A short message that stands out', 'চোখে পড়ার মতো একটি ছোট বার্তা'),
    category: 'promotion',
    titleField: 'title',
    fields: {
        tone: field.select(
            label('Kind', 'ধরন'),
            [
                { value: 'info', label: label('Information', 'তথ্য') },
                { value: 'success', label: label('Good news', 'ভালো খবর') },
                { value: 'warning', label: label('Take note', 'খেয়াল করুন') },
            ],
            'info',
        ),
        title: field.text(label('Title', 'শিরোনাম'), undefined, { max: 120 }),
        text: field.textarea(L.text, undefined, { max: 600 }),
    },
    preset: {
        title: label('Free delivery this week', 'এই সপ্তাহে ফ্রি ডেলিভারি'),
        text: label('On every order above ৳1,000.', '৳১,০০০-এর বেশি সব অর্ডারে।'),
    },
});

export const announcementElement = defineElement({
    type: 'announcement',
    version: 1,
    name: label('Announcement bar', 'ঘোষণার বার'),
    description: label(
        'One line across the page, in your brand colour',
        'পেজজুড়ে এক লাইন, আপনার ব্র্যান্ডের রঙে',
    ),
    category: 'promotion',
    titleField: 'text',
    fields: {
        text: field.text(L.text, undefined, { max: 160 }),
        link: field.link(L.link, { type: 'none' }),
    },
    preset: { text: label('Cash on delivery all over Bangladesh', 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি') },
});

export const tickerElement = defineElement({
    type: 'ticker',
    version: 1,
    name: label('Ticker', 'চলমান লেখা'),
    description: label(
        'Short lines that glide across, one after another',
        'ছোট ছোট লাইন, একটির পর একটি ভেসে যায়',
    ),
    category: 'promotion',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Lines, one per line', 'প্রতি লাইনে একটি'), undefined, { max: 1000 }),
        speed: field.select(
            label('Speed', 'গতি'),
            [
                { value: 'slow', label: label('Slow', 'ধীরে') },
                { value: 'normal', label: label('Normal', 'স্বাভাবিক') },
                { value: 'fast', label: label('Fast', 'দ্রুত') },
            ],
            'normal',
        ),
    },
    preset: {
        items: label(
            'Cash on delivery\nDelivery to all 64 districts\nEasy returns\nCheck before you pay',
            'ক্যাশ অন ডেলিভারি\n৬৪ জেলায় ডেলিভারি\nসহজ রিটার্ন\nদেখে টাকা দিন',
        ),
    },
});

export const stepsElement = defineElement({
    type: 'steps',
    version: 1,
    name: label('How it works', 'যেভাবে কাজ করে'),
    description: label(
        'Numbered steps, each with a line of text',
        'নম্বর দেওয়া ধাপ, প্রতিটির সাথে এক লাইন লেখা',
    ),
    category: 'promotion',
    titleField: 'items',
    fields: {
        items: field.textarea(label('Steps', 'ধাপ'), undefined, {
            max: 3000,
            hint: rowsHint('Step | Text', 'ধাপ | লেখা'),
        }),
    },
    preset: {
        items: label(
            'Choose a product | Press "Buy now" on what you like.\nGive your details | Your name, mobile number and address.\nPay on delivery | Check your order, then pay.',
            'পণ্য বেছে নিন | পছন্দের পণ্যে "এখনই কিনুন" চাপুন।\nনাম ও ঠিকানা দিন | নাম, মোবাইল নম্বর আর ঠিকানা লিখুন।\nহাতে পেয়ে টাকা দিন | পণ্য দেখে তারপর টাকা দিন।',
        ),
    },
});

export const compareElement = defineElement({
    type: 'compare',
    version: 1,
    name: label('Comparison table', 'তুলনার টেবিল'),
    description: label('Yours beside the others, row by row', 'আপনারটি আর অন্যদেরটি পাশাপাশি, সারি ধরে'),
    category: 'promotion',
    titleField: 'rows',
    fields: {
        ours: field.text(label('Your column', 'আপনার কলাম'), label('Ours', 'আমাদের'), { max: 60 }),
        theirs: field.text(label('The other column', 'অন্য কলাম'), label('Others', 'অন্যদের'), { max: 60 }),
        rows: field.textarea(label('Rows', 'সারি'), undefined, {
            max: 3000,
            hint: rowsHint('What | Yours | Theirs', 'কী | আপনার | অন্যদের'),
        }),
    },
    preset: {
        rows: label(
            'Price | ৳650 | ৳900\nDelivery | 2 days | 5 days\nReturns | 3 days | None',
            'দাম | ৳৬৫০ | ৳৯০০\nডেলিভারি | ২ দিন | ৫ দিন\nরিটার্ন | ৩ দিন | নেই',
        ),
    },
});

export const statElement = defineElement({
    type: 'stat',
    version: 1,
    name: label('Number', 'সংখ্যা'),
    description: label('One large number with what it counts', 'একটি বড় সংখ্যা, আর সেটি কীসের'),
    category: 'trust',
    titleField: 'value',
    fields: {
        value: field.text(label('Number', 'সংখ্যা'), undefined, { max: 20 }),
        label: field.text(label('What it counts', 'কীসের সংখ্যা'), undefined, { max: 80 }),
    },
    preset: { value: label('5,000+', '৫,০০০+'), label: label('Happy buyers', 'খুশি ক্রেতা') },
});

export const progressElement = defineElement({
    type: 'progress',
    version: 1,
    name: label('Progress bar', 'অগ্রগতির বার'),
    description: label(
        'A bar that is part full, like "72% sold"',
        'আংশিক ভরা একটি বার, যেমন "৭২% বিক্রি হয়ে গেছে"',
    ),
    category: 'promotion',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), undefined, { max: 80 }),
        percent: field.range(label('How full', 'কতটা ভরা'), { min: 0, max: 100, step: 1 }, 72),
    },
    preset: {
        label: label(
            '72% sold. Order before it runs out.',
            '৭২% বিক্রি হয়ে গেছে। শেষ হওয়ার আগে অর্ডার করুন।',
        ),
    },
});

export const testimonialElement = defineElement({
    type: 'testimonial',
    version: 1,
    name: label('Testimonial card', 'মতামতের কার্ড'),
    description: label(
        "One buyer's words, with their name, photo and stars",
        'একজন ক্রেতার কথা, নাম, ছবি আর তারাসহ',
    ),
    category: 'trust',
    titleField: 'text',
    fields: {
        text: field.textarea(label('What they said', 'তিনি যা বলেছেন'), undefined, { max: 600 }),
        name: field.text(label('Name', 'নাম'), undefined, { max: 80 }),
        place: field.text(label('Where they are from', 'কোথাকার'), undefined, { max: 80 }),
        rating: field.range(label('Stars', 'তারা'), { min: 0, max: 5 }, 5),
        photo: field.image(label('Photo', 'ছবি')),
    },
    preset: {
        text: label(
            'Exactly as in the photos, and it came on time.',
            'ছবিতে যেমন দেখেছি ঠিক তেমনই পেয়েছি, সময়মতো।',
        ),
        name: label('A customer', 'একজন ক্রেতা'),
        place: label('Dhaka', 'ঢাকা'),
    },
});

export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'tiktok'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const socialElement = defineElement({
    type: 'social',
    version: 1,
    name: label('Social icons', 'সোশ্যাল আইকন'),
    description: label(
        'Links to your Facebook page, Instagram, YouTube and more',
        'আপনার ফেসবুক পেজ, ইনস্টাগ্রাম, ইউটিউব আর অন্যগুলোর লিংক',
    ),
    category: 'trust',
    fields: {
        facebook: field.url(label('Facebook page', 'ফেসবুক পেজ')),
        instagram: field.url(label('Instagram', 'ইনস্টাগ্রাম')),
        youtube: field.url(label('YouTube', 'ইউটিউব')),
        tiktok: field.url(label('TikTok', 'টিকটক')),
        whatsapp: field.toggle(label('WhatsApp (your store’s number)', 'হোয়াটসঅ্যাপ (স্টোরের নম্বর)'), true),
        size: field.range(label('Size', 'মাপ'), { min: 20, max: 48, step: 4 }, 28),
    },
});

export const logosElement = defineElement({
    type: 'logos',
    version: 1,
    name: label('Logo strip', 'লোগোর সারি'),
    description: label(
        'Brands you sell, or where you were featured',
        'যেসব ব্র্যান্ড বিক্রি করেন, বা যেখানে আপনার কথা এসেছে',
    ),
    category: 'trust',
    fields: images(6),
});

export const galleryElement = defineElement({
    type: 'gallery',
    version: 1,
    name: label('Gallery', 'গ্যালারি'),
    description: label('Up to eight photos in a grid', 'গ্রিডে আটটি পর্যন্ত ছবি'),
    category: 'media',
    fields: {
        columns: field.range(label('Columns on computers', 'কম্পিউটারে কলাম'), { min: 2, max: 4 }, 4),
        shape,
        ...images(8),
    },
});

export const carouselElement = defineElement({
    type: 'carousel',
    version: 1,
    name: label('Image carousel', 'ছবির ক্যারোসেল'),
    description: label(
        'Photos side by side that shoppers swipe through',
        'পাশাপাশি ছবি, ক্রেতা আঙুলে সরিয়ে দেখেন',
    ),
    category: 'media',
    fields: { shape, ...images(6) },
});

export const mapElement = defineElement({
    type: 'map',
    version: 1,
    name: label('Map', 'ম্যাপ'),
    description: label('Your shop on Google Maps', 'গুগল ম্যাপে আপনার দোকান'),
    category: 'media',
    fields: {
        place: field.plain(label('Address or place name', 'ঠিকানা বা জায়গার নাম'), {
            max: 200,
            hint: label('As you would type it into Google Maps', 'গুগল ম্যাপে যেভাবে লিখে খোঁজেন'),
        }),
        height: field.range(label('Height', 'উচ্চতা'), { min: 200, max: 600, step: 20 }, 320),
    },
});

export const pricingElement = defineElement({
    type: 'pricing',
    version: 1,
    name: label('Pricing package', 'প্যাকেজের দাম'),
    description: label(
        'A package with its price, what is in it and a button',
        'একটি প্যাকেজ, দাম, যা যা আছে আর একটি বাটন',
    ),
    category: 'products',
    titleField: 'title',
    fields: {
        title: field.text(label('Package name', 'প্যাকেজের নাম'), undefined, { max: 80 }),
        price: field.money(label('Price', 'দাম')),
        oldPrice: field.money(label('Old price (crossed out)', 'আগের দাম (কাটা)')),
        features: field.textarea(
            label('What is in it, one per line', 'যা যা আছে, প্রতি লাইনে একটি'),
            undefined,
            { max: 1200 },
        ),
        button: field.text(label('Button label', 'বাটনের লেখা'), label('Order now', 'এখনই অর্ডার করুন'), {
            max: 40,
        }),
        link: field.link(L.link, { type: 'anchor', anchor: 'order' }),
        featured: field.toggle(label('Mark as the best choice', 'সেরা পছন্দ হিসেবে দেখান'), false),
    },
    preset: {
        title: label('Family pack', 'ফ্যামিলি প্যাক'),
        price: 120_000,
        oldPrice: 150_000,
        features: label(
            '2 jars of 500 g\nFree delivery\nA wooden spoon',
            '৫০০ গ্রামের ২টি জার\nফ্রি ডেলিভারি\nএকটি কাঠের চামচ',
        ),
    },
});

export const callElement = defineElement({
    type: 'call',
    version: 1,
    name: label('Call button', 'কল বাটন'),
    description: label('Calls your store’s phone number', 'আপনার স্টোরের ফোন নম্বরে কল যায়'),
    category: 'store',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), label('Call us', 'কল করুন'), { max: 60 }),
        look: buttonLook,
    },
});

export const whatsappElement = defineElement({
    type: 'whatsapp',
    version: 1,
    name: label('WhatsApp button', 'হোয়াটসঅ্যাপ বাটন'),
    description: label(
        'Opens a chat with your store, with a message ready',
        'আপনার স্টোরের সাথে চ্যাট খোলে, বার্তা লেখা থাকে',
    ),
    category: 'store',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), label('Order on WhatsApp', 'হোয়াটসঅ্যাপে অর্ডার করুন'), {
            max: 60,
        }),
        message: field.text(
            label('Message that is ready to send', 'যে বার্তা লেখা থাকবে'),
            label('I want to order.', 'আমি অর্ডার করতে চাই।'),
            {
                max: 200,
            },
        ),
        look: buttonLook,
    },
});

export const emailElement = defineElement({
    type: 'email',
    version: 1,
    name: label('Email button', 'ইমেইল বাটন'),
    description: label('Opens an email to you', 'আপনাকে ইমেইল লেখার জানালা খোলে'),
    category: 'store',
    titleField: 'label',
    fields: {
        label: field.text(label('Label', 'লেখা'), label('Email us', 'ইমেইল করুন'), { max: 60 }),
        email: field.plain(label('Email address', 'ইমেইল ঠিকানা'), { max: 120 }),
        look: buttonLook,
    },
});

/** Every element, in the order the editor lists them. */
export const ELEMENTS: readonly ElementDefinition[] = [
    container,
    headingElement,
    textElement,
    buttonElement,
    imageElement,
    iconElement,
    sectionTitleElement,
    listElement,
    iconListElement,
    iconBoxElement,
    badgeElement,
    toggleElement,
    dividerElement,
    spacerElement,
    // Promotion
    announcementElement,
    noticeElement,
    tickerElement,
    countdownElement,
    progressElement,
    accordionElement,
    tabsElement,
    stepsElement,
    compareElement,
    // Products
    priceElement,
    pricingElement,
    // Media
    videoElement,
    galleryElement,
    carouselElement,
    mapElement,
    // Trust
    starsElement,
    quoteElement,
    testimonialElement,
    statElement,
    logosElement,
    socialElement,
    // Store
    callElement,
    whatsappElement,
    emailElement,
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

import type { LayoutDocument, SectionData } from './define';
import { createSection, newId, readSection } from './document';
import type { ImageValue } from './fields';
import type { SectionStyle } from './style';
import type { Bilingual } from './text';

/**
 * Sales page templates (roadmap phase 16, grown from twelve to thirty-one in phase 59): ready pages
 * for what Bangladeshi merchants sell from Facebook ads, and a few building blocks to start from. Each is ordinary sections, so everything stays editable; the product's name
 * goes into the text, and its photo, price and packs come from the page itself.
 */

export const LANDING_CATEGORIES = [
    'food',
    'health',
    'beauty',
    'fashion',
    'gadgets',
    'kids',
    'other',
] as const;
export type LandingCategory = (typeof LANDING_CATEGORIES)[number];

export const LANDING_CATEGORY_NAMES: Record<LandingCategory, Bilingual> = {
    food: { bn: 'খাবার', en: 'Food' },
    health: { bn: 'স্বাস্থ্য ও হারবাল', en: 'Health and herbal' },
    beauty: { bn: 'সৌন্দর্য', en: 'Beauty' },
    fashion: { bn: 'পোশাক', en: 'Fashion' },
    gadgets: { bn: 'গ্যাজেট', en: 'Gadgets' },
    kids: { bn: 'শিশু', en: 'Baby and kids' },
    other: { bn: 'অন্যান্য', en: 'Other' },
};

export interface LandingTemplate {
    id: string;
    category: LandingCategory;
    name: Bilingual;
    description: Bilingual;
    build(product: { name: Bilingual }): LayoutDocument;
}

const t = (bn: string, en: string): Bilingual => ({ bn, en });

interface Options {
    hidden?: boolean;
    style?: Partial<SectionStyle>;
    blocks?: Array<Record<string, unknown>>;
}

function make(type: string, settings: Record<string, unknown> = {}, options: Options = {}): SectionData {
    const base = createSection(type);
    return readSection({
        ...base,
        hidden: options.hidden ?? false,
        settings: { ...base.settings, ...settings },
        blocks: options.blocks ? options.blocks.map(block => ({ settings: block })) : base.blocks,
        style: { ...base.style, ...options.style },
    })!;
}

/** "Order now" under a section, jumping to the form. */
const ordered: Partial<SectionStyle> = { orderButton: true };

const named = (product: { name: Bilingual }, bn: (name: string) => string, en: (name: string) => string) =>
    t(bn(product.name.bn || product.name.en), en(product.name.en || product.name.bn));

const benefit = (icon: string, bn: string, en: string, textBn = '', textEn = '') => ({
    icon,
    title: t(bn, en),
    text: t(textBn, textEn),
});

const faqItem = (questionBn: string, questionEn: string, answerBn: string, answerEn: string) => ({
    question: t(questionBn, questionEn),
    answer: t(answerBn, answerEn),
});

const codFaq = [
    faqItem(
        'কীভাবে অর্ডার করব?',
        'How do I order?',
        'নিচের ফর্মে নাম, মোবাইল নম্বর আর ঠিকানা দিন। আমরা কল করে কনফার্ম করব।',
        'Fill in your name, mobile number and address in the form below. We call to confirm.',
    ),
    faqItem(
        'টাকা কখন দেব?',
        'When do I pay?',
        'পণ্য হাতে পেয়ে, দেখে তারপর টাকা দিন।',
        'When the product reaches you, after you check it.',
    ),
    faqItem(
        'ডেলিভারিতে কতদিন লাগে?',
        'How long does delivery take?',
        'ঢাকার ভেতরে সাধারণত ১–২ দিন, ঢাকার বাইরে ২–৪ দিন।',
        'Usually 1–2 days inside Dhaka and 2–4 days outside Dhaka.',
    ),
];

const trustSales = () =>
    make(
        'trust-badges',
        { heading: t('কেন আমাদের কাছ থেকে কিনবেন', 'Why buy from us') },
        {
            blocks: [
                benefit(
                    'cash',
                    'ক্যাশ অন ডেলিভারি',
                    'Cash on delivery',
                    'হাতে পেয়ে টাকা দিন',
                    'Pay when it arrives',
                ),
                benefit(
                    'check',
                    'দেখে টাকা দিন',
                    'Check before you pay',
                    'পছন্দ না হলে ফেরত',
                    'Return it if you don’t like it',
                ),
                benefit(
                    'truck',
                    'সারা দেশে ডেলিভারি',
                    'Delivery all over Bangladesh',
                    '৬৪ জেলায়',
                    'To all 64 districts',
                ),
                benefit(
                    'return',
                    'সহজ রিটার্ন',
                    'Easy returns',
                    'সমস্যা হলে ফেরত দিন',
                    'Return it if something’s wrong',
                ),
            ],
            style: ordered,
        },
    );

const reviews = () =>
    make(
        'testimonials',
        { heading: t('কাস্টমাররা যা বলছেন', 'What customers say'), look: 'screenshots' },
        { hidden: true },
    );

const close = () => [
    make('faq', {}, { blocks: codFaq }),
    make('order-form'),
    make('whatsapp-cta', {
        heading: t('অর্ডার নিয়ে প্রশ্ন আছে?', 'Questions about your order?'),
        text: t('কল বা হোয়াটসঅ্যাপ করুন, আমরা সাহায্য করব।', 'Call or WhatsApp us and we’ll help.'),
    }),
];

const hero = (
    product: { name: Bilingual },
    badge: Bilingual,
    highlight: Bilingual,
    textValue: Bilingual = t('', ''),
) =>
    make('sales-hero', {
        badge,
        headline: named(
            product,
            name => name,
            name => name,
        ),
        highlight,
        text: textValue,
    });

const story = (headingValue: Bilingual, body: Bilingual, right = false) =>
    make(
        'image-with-text',
        { heading: headingValue, text: body, imagePosition: right ? 'right' : 'left' },
        { style: ordered },
    );

export const LANDING_TEMPLATES: readonly LandingTemplate[] = [
    {
        id: 'ghee-honey',
        category: 'food',
        name: t('ঘি ও মধু', 'Ghee and honey'),
        description: t(
            'খাঁটির গল্প, আসল চেনার উপায়, ওজন অনুযায়ী প্যাক',
            'Purity story, how to spot the real thing, packs by weight',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('১০০% খাঁটি', '100% pure'),
                    t('সরাসরি খামার থেকে আপনার ঘরে', 'From the farm to your home'),
                ),
                make(
                    'benefits',
                    { heading: t('কেন আমাদের ঘি/মধু', 'Why ours') },
                    {
                        blocks: [
                            benefit('leaf', 'কোনো ভেজাল নেই', 'Nothing added'),
                            benefit('shield', 'ল্যাবে পরীক্ষা করা', 'Lab tested'),
                            benefit('box', 'ফুড-গ্রেড বোতলে প্যাক', 'Packed in food-grade jars'),
                            benefit('cash', 'হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
                        ],
                        style: ordered,
                    },
                ),
                story(
                    t('আসল চিনবেন কীভাবে', 'How to tell the real thing'),
                    t(
                        '<p>খাঁটি ঘিয়ের দানাদার ভাব আর সুবাস, মধুর ঘনত্ব: কীভাবে বুঝবেন তা এখানে লিখুন।</p>',
                        '<p>Explain how to recognise pure ghee or honey: texture, smell, thickness.</p>',
                    ),
                ),
                make('comparison', {}, { style: ordered }),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'oil-spices',
        category: 'food',
        name: t('তেল ও মসলা', 'Oil and spices'),
        description: t(
            'ঘানি ভাঙা তেল, খাঁটি মসলা: উৎস, ব্যবহার আর প্যাক',
            'Cold-pressed oil, pure spices: source, uses and packs',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('ঘানি ভাঙা', 'Cold-pressed'),
                    t('রান্নায় আসল স্বাদ ফিরিয়ে আনুন', 'Bring back the real taste'),
                ),
                make(
                    'benefits',
                    { look: 'grid', columns: 2 },
                    {
                        blocks: [
                            benefit('leaf', 'রাসায়নিক মুক্ত', 'No chemicals'),
                            benefit('check', 'নিজেদের তত্ত্বাবধানে তৈরি', 'Made under our own care'),
                            benefit('box', 'নিরাপদ প্যাকেজিং', 'Safe packaging'),
                            benefit('truck', 'সারা দেশে ডেলিভারি', 'Delivery all over Bangladesh'),
                        ],
                        style: ordered,
                    },
                ),
                make('specs', { heading: t('বিস্তারিত', 'Details') }),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'dates-dry-food',
        category: 'food',
        name: t('খেজুর ও শুকনো খাবার', 'Dates and dry food'),
        description: t(
            'রমজান আর উপহারের জন্য: জাত, ওজন, অফার',
            'For Ramadan and gifts: variety, weight, offers',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('রমজান অফার', 'Ramadan offer'),
                    t('বাছাই করা প্রিমিয়াম খেজুর', 'Hand-picked premium dates'),
                ),
                make('countdown', { mode: 'evergreen', hours: 12 }),
                make(
                    'benefits',
                    {},
                    {
                        blocks: [
                            benefit('star', 'প্রিমিয়াম মান', 'Premium quality'),
                            benefit('box', 'এয়ারটাইট প্যাক', 'Airtight packs'),
                            benefit('gift', 'উপহার দেওয়ার মতো', 'Ready to gift'),
                        ],
                        style: ordered,
                    },
                ),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'herbal',
        category: 'health',
        name: t('হারবাল পণ্য', 'Herbal product'),
        description: t(
            'উপাদান, ব্যবহারের নিয়ম আর গ্যারান্টি। শুধু সত্যি দাবি লিখুন।',
            'Ingredients, how to use and a guarantee. Make honest claims only.',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('প্রাকৃতিক উপাদান', 'Natural ingredients'),
                    t('যা আছে, তা-ই লিখি: কোনো অতিরঞ্জন নয়', 'We say what’s in it, nothing more'),
                    t(
                        'এখানে পণ্যটি কী এবং কার জন্য, তা সংক্ষেপে লিখুন। রোগ সারানোর দাবি করবেন না।',
                        'Say briefly what the product is and who it’s for. Don’t claim it cures illnesses.',
                    ),
                ),
                make('benefits', { heading: t('উপাদান', 'Ingredients') }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('ব্যবহারের নিয়ম', 'How to use'), look: 'steps' },
                    {
                        blocks: [
                            {
                                label: t('প্রথম ধাপ', 'Step one'),
                                value: t('কীভাবে শুরু করবেন লিখুন', 'Explain how to start'),
                            },
                            {
                                label: t('দ্বিতীয় ধাপ', 'Step two'),
                                value: t('কতটুকু, কতবার', 'How much, how often'),
                            },
                            {
                                label: t('সতর্কতা', 'Caution'),
                                value: t('কারা ব্যবহার করবেন না', 'Who shouldn’t use it'),
                            },
                        ],
                    },
                ),
                make('guarantee'),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'skin-care',
        category: 'beauty',
        name: t('স্কিন কেয়ার', 'Skin care'),
        description: t(
            'উপাদান, ব্যবহারের নিয়ম, আসল পণ্যের প্রমাণ',
            'Ingredients, how to use, proof it’s genuine',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('১০০% অরিজিনাল', '100% original'),
                    t('আপনার ত্বকের যত্নে', 'Care for your skin'),
                ),
                make(
                    'benefits',
                    { look: 'grid', columns: 2 },
                    {
                        blocks: [
                            benefit('shield', 'আসল পণ্যের নিশ্চয়তা', 'Guaranteed genuine'),
                            benefit('leaf', 'ত্বকের জন্য নিরাপদ', 'Gentle on skin'),
                            benefit('star', 'হাজারো কাস্টমারের পছন্দ', 'Loved by thousands'),
                            benefit('cash', 'হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
                        ],
                        style: ordered,
                    },
                ),
                make(
                    'specs',
                    { heading: t('কীভাবে ব্যবহার করবেন', 'How to use'), look: 'steps' },
                    {
                        blocks: [
                            { label: t('মুখ ধুয়ে নিন', 'Wash your face'), value: t('', '') },
                            { label: t('অল্প পরিমাণ লাগান', 'Apply a little'), value: t('', '') },
                            { label: t('দিনে দুবার', 'Twice a day'), value: t('', '') },
                        ],
                    },
                ),
                make('price-packs'),
                reviews(),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'perfume',
        category: 'beauty',
        name: t('পারফিউম ও আতর', 'Perfume and attar'),
        description: t(
            'সুবাসের বর্ণনা, কতক্ষণ থাকে, উপহার প্যাক',
            'The scent, how long it lasts, gift packs',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('দীর্ঘস্থায়ী সুবাস', 'Long-lasting scent'),
                    t('একবার লাগালেই সারাদিন', 'One touch lasts all day'),
                ),
                make(
                    'specs',
                    { heading: t('সুবাসের বর্ণনা', 'The scent') },
                    {
                        blocks: [
                            { label: t('শুরুর সুবাস', 'Top notes'), value: t('', '') },
                            { label: t('মাঝের সুবাস', 'Heart notes'), value: t('', '') },
                            { label: t('কতক্ষণ থাকে', 'Lasts'), value: t('৮–১০ ঘণ্টা', '8–10 hours') },
                        ],
                        style: ordered,
                    },
                ),
                make('price-packs'),
                reviews(),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'fashion-single',
        category: 'fashion',
        name: t('একটি পোশাক', 'Single item'),
        description: t('পাঞ্জাবি, বোরকা: বড় ছবি, কাপড়, সাইজ', 'Panjabi, borka: big photos, fabric, sizes'),
        build: product => ({
            sections: [
                hero(product, t('নতুন', 'New'), t('ঈদের জন্য বিশেষ ডিজাইন', 'A special design for Eid')),
                make('image-grid', { heading: t('আরও ছবি', 'More photos') }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('কাপড় ও মাপ', 'Fabric and fit') },
                    {
                        blocks: [
                            { label: t('কাপড়', 'Fabric'), value: t('সুতি', 'Cotton') },
                            { label: t('রং', 'Colour'), value: t('', '') },
                            { label: t('সাইজ', 'Sizes'), value: t('M, L, XL, XXL', 'M, L, XL, XXL') },
                        ],
                    },
                ),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'fashion-sizes',
        category: 'fashion',
        name: t('কয়েকটি পোশাক ও সাইজ চার্ট', 'Several items with a size chart'),
        description: t('থ্রি-পিস, কুর্তি: রং আর সাইজ চার্ট', 'Three-piece, kurti: colours and a size chart'),
        build: product => ({
            sections: [
                hero(product, t('কম্বো অফার', 'Combo offer'), t('পছন্দের রং বেছে নিন', 'Pick your colours')),
                make('image-grid', { heading: t('সব রং', 'All colours'), columns: 3 }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('সাইজ চার্ট (ইঞ্চি)', 'Size chart (inches)') },
                    {
                        blocks: [
                            { label: t('M', 'M'), value: t('বুক ৩৮, লম্বা ৪২', 'Chest 38, length 42') },
                            { label: t('L', 'L'), value: t('বুক ৪০, লম্বা ৪৩', 'Chest 40, length 43') },
                            { label: t('XL', 'XL'), value: t('বুক ৪২, লম্বা ৪৪', 'Chest 42, length 44') },
                        ],
                    },
                ),
                make('price-packs'),
                reviews(),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'gadget',
        category: 'gadgets',
        name: t('গ্যাজেট', 'Gadget'),
        description: t(
            'ফিচার, স্পেসিফিকেশন, ডেমো ভিডিও আর ওয়ারেন্টি',
            'Features, specs, a demo video and warranty',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('অফিসিয়াল ওয়ারেন্টি', 'Official warranty'),
                    t('ছোট, শক্তিশালী, কাজের', 'Small, powerful, useful'),
                ),
                make(
                    'video',
                    { heading: t('কীভাবে কাজ করে দেখুন', 'See how it works') },
                    { hidden: true, style: ordered },
                ),
                make(
                    'benefits',
                    { heading: t('ফিচার', 'Features'), look: 'grid', columns: 2 },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('স্পেসিফিকেশন', 'Specifications') },
                    {
                        blocks: [
                            { label: t('ব্যাটারি', 'Battery'), value: t('', '') },
                            { label: t('ওয়ারেন্টি', 'Warranty'), value: t('৬ মাস', '6 months') },
                            { label: t('বক্সে যা আছে', 'In the box'), value: t('', '') },
                        ],
                    },
                ),
                make('guarantee', {
                    heading: t('ওয়ারেন্টি', 'Warranty'),
                    text: t(
                        'কোনো সমস্যা হলে ওয়ারেন্টির মধ্যে বদলে দেব।',
                        'If anything goes wrong within the warranty, we replace it.',
                    ),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'baby',
        category: 'kids',
        name: t('শিশুদের পণ্য', 'Baby product'),
        description: t(
            'নিরাপত্তা, বয়স আর মায়েদের মতামত',
            'Safety points, age range and reviews from mothers',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('শিশুর জন্য নিরাপদ', 'Safe for babies'),
                    t('মায়েদের পছন্দ', 'Mothers’ choice'),
                ),
                make(
                    'benefits',
                    { heading: t('নিরাপত্তা', 'Safety') },
                    {
                        blocks: [
                            benefit('shield', 'বিপিএ মুক্ত', 'BPA free'),
                            benefit('check', 'নরম ও আরামদায়ক', 'Soft and comfortable'),
                            benefit('leaf', 'ত্বকের জন্য নিরাপদ', 'Gentle on skin'),
                        ],
                        style: ordered,
                    },
                ),
                make(
                    'specs',
                    { heading: t('কোন বয়সের জন্য', 'Age range') },
                    {
                        blocks: [{ label: t('বয়স', 'Age'), value: t('০–৩ বছর', '0–3 years') }],
                    },
                ),
                make(
                    'testimonials',
                    { heading: t('মায়েরা যা বলছেন', 'What mothers say') },
                    { hidden: true },
                ),
                make('price-packs'),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'seasonal-combo',
        category: 'other',
        name: t('ঈদ বা শীতের কম্বো', 'Seasonal combo'),
        description: t(
            'কম্বোতে কী আছে আর সময় শেষ হওয়ার কাউন্টডাউন',
            'What’s in the bundle and a countdown',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('কম্বো অফার', 'Combo offer'),
                    t('একসাথে নিলে বেশি সাশ্রয়', 'Save more together'),
                ),
                make('countdown', { mode: 'evergreen', hours: 24 }),
                make('benefits', { heading: t('কম্বোতে যা আছে', 'In the bundle') }, { style: ordered }),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'general',
        category: 'other',
        name: t('সাধারণ', 'General'),
        description: t('যেকোনো পণ্যের জন্য একটি পরিষ্কার সেলস পেজ', 'A clean sales page for any product'),
        build: product => ({
            sections: [
                hero(product, t('বিশেষ অফার', 'Special offer'), t('সীমিত সময়ের জন্য', 'For a limited time')),
                make('benefits', {}, { style: ordered }),
                story(
                    t('পণ্যটি সম্পর্কে', 'About the product'),
                    t(
                        '<p>পণ্যটি কী, কেন কিনবেন, তা এখানে লিখুন।</p>',
                        '<p>Say what the product is and why it’s worth buying.</p>',
                    ),
                    true,
                ),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    // Phase 59: eighteen more, and building blocks to start a page from.
    {
        id: 'mango',
        category: 'food',
        name: t('মৌসুমি ফল', 'Seasonal fruit'),
        description: t(
            'বাগান থেকে সরাসরি, মৌসুম শেষের কাউন্টডাউনসহ',
            'Straight from the orchard, with an end-of-season countdown',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('বাগান থেকে সরাসরি', 'Straight from the orchard'),
                    t('কেমিক্যাল ছাড়া পাকানো', 'Ripened without chemicals'),
                ),
                make('countdown', {
                    heading: t('মৌসুম শেষ হতে বাকি', 'The season ends in'),
                    mode: 'evergreen',
                    hours: 48,
                }),
                make(
                    'benefits',
                    { heading: t('কেন আমাদের ফল', 'Why our fruit') },
                    {
                        blocks: [
                            benefit('leaf', 'ফরমালিন ও কার্বাইডমুক্ত', 'No formalin or carbide'),
                            benefit('box', 'ক্যারেটে যত্ন করে প্যাক', 'Carefully packed in crates'),
                            benefit('truck', 'পাড়ার পরদিনই পাঠানো', 'Sent the day after picking'),
                            benefit('return', 'নষ্ট হলে বদলে দিই', 'Replaced if it arrives spoiled'),
                        ],
                        style: ordered,
                    },
                ),
                story(
                    t('আমাদের বাগান', 'Our orchard'),
                    t(
                        '<p>বাগান কোথায়, কোন জাতের ফল আর কীভাবে পাকানো হয়, তা এখানে লিখুন।</p>',
                        '<p>Say where the orchard is, which varieties you grow and how they ripen.</p>',
                    ),
                ),
                make('price-packs', { heading: t('কত কেজি নেবেন?', 'How many kilos?') }),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'pickle',
        category: 'food',
        name: t('আচার ও সস', 'Pickles and sauces'),
        description: t(
            'ঘরে বানানো স্বাদ, উপাদানের তালিকা আর জারের মাপ',
            'Home-made taste, the ingredients and jar sizes',
        ),
        build: product => ({
            sections: [
                hero(product, t('ঘরে বানানো', 'Home-made'), t('মায়ের হাতের সেই স্বাদ', 'The taste of home')),
                make('benefits', { heading: t('যা দিয়ে বানানো', 'What goes in') }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('এক নজরে', 'At a glance') },
                    {
                        blocks: [
                            { label: t('ওজন', 'Weight'), value: t('', '') },
                            { label: t('মেয়াদ', 'Keeps for'), value: t('৬ মাস', '6 months') },
                            {
                                label: t('সংরক্ষণ', 'Storage'),
                                value: t('ঠান্ডা, শুকনো জায়গায়', 'Somewhere cool and dry'),
                            },
                        ],
                    },
                ),
                make('price-packs'),
                trustSales(),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'tea',
        category: 'food',
        name: t('চা ও কফি', 'Tea and coffee'),
        description: t(
            'বাগানের গল্প, বানানোর নিয়ম আর প্যাকের মাপ',
            'The garden’s story, how to brew and pack sizes',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('বাগানের তাজা পাতা', 'Fresh from the garden'),
                    t('প্রতি কাপে আসল স্বাদ', 'Real taste in every cup'),
                ),
                story(
                    t('কোন বাগানের চা', 'Where it grows'),
                    t(
                        '<p>চা কোন বাগানের, কখন তোলা আর স্বাদ কেমন, তা এখানে লিখুন।</p>',
                        '<p>Say which garden it comes from, when it was picked and how it tastes.</p>',
                    ),
                    true,
                ),
                make(
                    'specs',
                    { heading: t('যেভাবে বানাবেন', 'How to brew'), look: 'steps' },
                    {
                        blocks: [
                            {
                                label: t('পানি ফোটান', 'Boil the water'),
                                value: t('এক কাপ পানি ফুটিয়ে নিন।', 'Bring one cup of water to the boil.'),
                            },
                            {
                                label: t('পাতা দিন', 'Add the leaves'),
                                value: t(
                                    'এক চা-চামচ পাতা দিয়ে ২ মিনিট রাখুন।',
                                    'Add one teaspoon and leave for 2 minutes.',
                                ),
                            },
                            {
                                label: t('ছেঁকে নিন', 'Strain'),
                                value: t('ছেঁকে গরম গরম পরিবেশন করুন।', 'Strain and serve hot.'),
                            },
                        ],
                    },
                ),
                make('price-packs'),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'pain-relief',
        category: 'health',
        name: t('ব্যথার তেল ও মালিশ', 'Pain relief oil'),
        description: t(
            'কীভাবে ব্যবহার করবেন, কারা ব্যবহার করবেন আর সতর্কতা',
            'How to use it, who it’s for and cautions',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('ভেষজ উপাদানে তৈরি', 'Made from herbs'),
                    t('প্রতিদিনের ব্যথায় আরাম', 'Ease for everyday aches'),
                ),
                make('benefits', { heading: t('কখন কাজে লাগে', 'When it helps') }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('ব্যবহারের নিয়ম', 'How to use it'), look: 'steps' },
                    {
                        blocks: [
                            {
                                label: t('পরিষ্কার করুন', 'Clean the area'),
                                value: t('ব্যথার জায়গা পরিষ্কার করে নিন।', 'Clean the area that hurts.'),
                            },
                            {
                                label: t('মালিশ করুন', 'Massage'),
                                value: t(
                                    'অল্প তেল নিয়ে ৫ মিনিট মালিশ করুন।',
                                    'Massage in a little oil for 5 minutes.',
                                ),
                            },
                            {
                                label: t('দিনে দুইবার', 'Twice a day'),
                                value: t('সকালে ও রাতে ব্যবহার করুন।', 'Use it morning and night.'),
                            },
                        ],
                    },
                ),
                make('guarantee', {
                    heading: t('সতর্কতা', 'Please note'),
                    text: t(
                        'এটি কোনো রোগের চিকিৎসা নয়। ব্যথা না কমলে ডাক্তারের পরামর্শ নিন।',
                        'This does not treat any disease. See a doctor if the pain stays.',
                    ),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'hair-oil',
        category: 'beauty',
        name: t('চুলের তেল', 'Hair oil'),
        description: t(
            'উপাদান, ব্যবহারের নিয়ম আর আগে-পরের তুলনা',
            'Ingredients, how to use it and a before-and-after comparison',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('প্রাকৃতিক উপাদানে', 'From natural ingredients'),
                    t('চুলের গোড়া থেকে যত্ন', 'Care from the roots'),
                ),
                make('benefits', { heading: t('যা আছে এই তেলে', 'What’s in the oil') }, { style: ordered }),
                make(
                    'comparison',
                    { heading: t('নিয়মিত ব্যবহারে', 'With regular use') },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('ব্যবহারের নিয়ম', 'How to use it'), look: 'steps' },
                    {
                        blocks: [
                            {
                                label: t('রাতে লাগান', 'Apply at night'),
                                value: t(
                                    'চুলের গোড়ায় আঙুল দিয়ে মালিশ করুন।',
                                    'Massage into the roots with your fingertips.',
                                ),
                            },
                            {
                                label: t('সকালে ধুয়ে ফেলুন', 'Wash in the morning'),
                                value: t('হালকা শ্যাম্পু দিয়ে ধুয়ে নিন।', 'Wash with a mild shampoo.'),
                            },
                            {
                                label: t('সপ্তাহে তিনদিন', 'Three times a week'),
                                value: t('নিয়মিত ব্যবহারে ফল পাবেন।', 'Results come with regular use.'),
                            },
                        ],
                    },
                ),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'makeup',
        category: 'beauty',
        name: t('মেকআপ', 'Makeup'),
        description: t(
            'শেড, অরিজিনাল পণ্যের প্রমাণ আর ব্যবহারের ভিডিও',
            'Shades, proof it’s genuine and a how-to video',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('১০০% অরিজিনাল', '100% genuine'),
                    t('সারা দিন টিকে থাকে', 'Stays on all day'),
                ),
                make(
                    'video',
                    { heading: t('লাগানোর নিয়ম দেখুন', 'See how to apply it') },
                    { hidden: true, style: ordered },
                ),
                make('benefits', { look: 'grid', columns: 2 }, { style: ordered }),
                make('guarantee', {
                    heading: t('অরিজিনাল পণ্যের নিশ্চয়তা', 'Guaranteed genuine'),
                    text: t(
                        'ব্যাচ নম্বর মিলিয়ে নিন। নকল প্রমাণ হলে পুরো টাকা ফেরত।',
                        'Check the batch number. A full refund if it proves fake.',
                    ),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'saree',
        category: 'fashion',
        name: t('শাড়ি', 'Saree'),
        description: t('কাপড়ের বিবরণ, বড় ছবি আর যত্নের নিয়ম', 'Fabric details, large photos and care'),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('নতুন ডিজাইন', 'New design'),
                    t('উৎসবে, আয়োজনে', 'For festivals and occasions'),
                ),
                make(
                    'image-grid',
                    { heading: t('কাছ থেকে দেখুন', 'Look closer'), shape: 'portrait', columns: 3 },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('শাড়ির বিবরণ', 'About the saree') },
                    {
                        blocks: [
                            { label: t('কাপড়', 'Fabric'), value: t('', '') },
                            { label: t('লম্বা', 'Length'), value: t('১২ হাত', '12 haat (5.5 m)') },
                            { label: t('ব্লাউজ পিস', 'Blouse piece'), value: t('আছে', 'Included') },
                            { label: t('ধোয়া', 'Washing'), value: t('ড্রাই ওয়াশ', 'Dry clean') },
                        ],
                    },
                ),
                trustSales(),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'panjabi',
        category: 'fashion',
        name: t('পাঞ্জাবি', 'Panjabi'),
        description: t(
            'মাপের চার্ট, কাপড়ের বিবরণ আর মাপ বদলের সুবিধা',
            'A size chart, fabric details and size exchange',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('ঈদ কালেকশন', 'Eid collection'),
                    t('আরামদায়ক কাপড়, নিখুঁত সেলাই', 'Comfortable fabric, neat stitching'),
                ),
                make('benefits', { look: 'grid', columns: 2 }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('মাপের চার্ট', 'Size chart') },
                    {
                        blocks: [
                            { label: t('M', 'M'), value: t('বুক ৪০", লম্বা ৪০"', 'Chest 40", length 40"') },
                            { label: t('L', 'L'), value: t('বুক ৪২", লম্বা ৪২"', 'Chest 42", length 42"') },
                            { label: t('XL', 'XL'), value: t('বুক ৪৪", লম্বা ৪৪"', 'Chest 44", length 44"') },
                        ],
                    },
                ),
                make('guarantee', {
                    heading: t('মাপ না মিললে বদলে দেব', 'Wrong size? We exchange it'),
                    text: t('ডেলিভারির ৩ দিনের মধ্যে জানান।', 'Tell us within 3 days of delivery.'),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'shoes',
        category: 'fashion',
        name: t('জুতা', 'Shoes'),
        description: t(
            'মাপ বাছাই, উপাদান আর পায়ে দিয়ে দেখার সুবিধা',
            'Choosing a size, materials and try before you pay',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('আরামদায়ক সোল', 'Comfortable sole'),
                    t('সারা দিন পায়ে, তবু আরাম', 'On your feet all day, still comfortable'),
                ),
                make('benefits', { look: 'grid', columns: 2 }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('মাপ', 'Sizes') },
                    {
                        blocks: [
                            { label: t('৩৯', '39'), value: t('২৪.৫ সেমি', '24.5 cm') },
                            { label: t('৪০', '40'), value: t('২৫ সেমি', '25 cm') },
                            { label: t('৪১', '41'), value: t('২৬ সেমি', '26 cm') },
                            { label: t('৪২', '42'), value: t('২৬.৫ সেমি', '26.5 cm') },
                        ],
                    },
                ),
                make('guarantee', {
                    heading: t('পায়ে দিয়ে দেখে টাকা দিন', 'Try them on, then pay'),
                    text: t(
                        'মাপ না মিললে ডেলিভারিম্যানের কাছেই ফেরত দিন।',
                        'If they don’t fit, hand them back to the delivery person.',
                    ),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'watch',
        category: 'fashion',
        name: t('ঘড়ি ও ব্যাগ', 'Watches and bags'),
        description: t('কাছ থেকে তোলা ছবি, উপাদান আর ওয়ারেন্টি', 'Close-up photos, materials and warranty'),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('প্রিমিয়াম কোয়ালিটি', 'Premium quality'),
                    t('উপহার দিতে বা নিজের জন্য', 'For a gift, or for yourself'),
                ),
                make(
                    'image-grid',
                    { heading: t('কাছ থেকে দেখুন', 'Look closer'), shape: 'square', columns: 3 },
                    { style: ordered },
                ),
                make('benefits', { look: 'grid', columns: 2 }, { style: ordered }),
                make('guarantee', {
                    heading: t('৬ মাসের ওয়ারেন্টি', '6-month warranty'),
                    text: t(
                        'কোনো সমস্যা হলে ওয়ারেন্টির মধ্যে ঠিক করে দেব।',
                        'If anything goes wrong within the warranty, we fix it.',
                    ),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'earbuds',
        category: 'gadgets',
        name: t('ইয়ারবাড ও হেডফোন', 'Earbuds and headphones'),
        description: t(
            'ব্যাটারি, সাউন্ড আর অন্য ব্র্যান্ডের সাথে তুলনা',
            'Battery, sound and a comparison with others',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('অফিসিয়াল ওয়ারেন্টি', 'Official warranty'),
                    t('পরিষ্কার শব্দ, লম্বা ব্যাটারি', 'Clear sound, long battery'),
                ),
                make(
                    'benefits',
                    { heading: t('ফিচার', 'Features'), look: 'grid', columns: 2 },
                    { style: ordered },
                ),
                make(
                    'comparison',
                    { heading: t('সাধারণ ইয়ারবাডের সাথে তুলনা', 'Against ordinary earbuds') },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('স্পেসিফিকেশন', 'Specifications') },
                    {
                        blocks: [
                            { label: t('ব্যাটারি', 'Battery'), value: t('', '') },
                            { label: t('ব্লুটুথ', 'Bluetooth'), value: t('', '') },
                            { label: t('ওয়ারেন্টি', 'Warranty'), value: t('৬ মাস', '6 months') },
                        ],
                    },
                ),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'smartwatch',
        category: 'gadgets',
        name: t('স্মার্টওয়াচ', 'Smartwatch'),
        description: t('ডেমো ভিডিও, ফিচার আর বক্সে যা আছে', 'A demo video, features and what’s in the box'),
        build: product => ({
            sections: [
                hero(product, t('নতুন মডেল', 'New model'), t('হাতেই সব খবর', 'Everything on your wrist')),
                make(
                    'video',
                    { heading: t('চালিয়ে দেখুন', 'See it working') },
                    { hidden: true, style: ordered },
                ),
                make(
                    'benefits',
                    { heading: t('যা যা করতে পারে', 'What it does'), look: 'grid', columns: 2 },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('বক্সে যা আছে', 'In the box') },
                    {
                        blocks: [
                            { label: t('ঘড়ি', 'Watch'), value: t('১টি', '1') },
                            { label: t('চার্জার', 'Charger'), value: t('১টি', '1') },
                            { label: t('ওয়ারেন্টি কার্ড', 'Warranty card'), value: t('১টি', '1') },
                        ],
                    },
                ),
                make('guarantee'),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'kitchen',
        category: 'gadgets',
        name: t('রান্নাঘরের জিনিস', 'Kitchen tools'),
        description: t(
            'সময় বাঁচানোর গল্প, ব্যবহারের ধাপ আর ভিডিও',
            'How it saves time, steps to use it and a video',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('রান্না এখন সহজ', 'Cooking made easier'),
                    t('অর্ধেক সময়ে একই কাজ', 'The same job in half the time'),
                ),
                make(
                    'video',
                    { heading: t('ব্যবহার দেখুন', 'See it in use') },
                    { hidden: true, style: ordered },
                ),
                make('comparison', { heading: t('আগে আর এখন', 'Before and now') }, { style: ordered }),
                make(
                    'specs',
                    { heading: t('ব্যবহারের ধাপ', 'How to use it'), look: 'steps' },
                    {
                        blocks: [
                            { label: t('প্রথম ধাপ', 'First'), value: t('', '') },
                            { label: t('দ্বিতীয় ধাপ', 'Then'), value: t('', '') },
                            {
                                label: t('ধুয়ে রাখুন', 'Wash and store'),
                                value: t('ব্যবহারের পর ধুয়ে শুকিয়ে রাখুন।', 'Wash and dry it after use.'),
                            },
                        ],
                    },
                ),
                make('price-packs'),
                trustSales(),
                ...close(),
            ],
        }),
    },
    {
        id: 'toy',
        category: 'kids',
        name: t('খেলনা', 'Toys'),
        description: t('বয়স, নিরাপত্তা আর শিশু কী শিখবে', 'Age, safety and what a child learns'),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('শিশুর জন্য নিরাপদ', 'Safe for children'),
                    t('খেলতে খেলতে শেখা', 'Learning through play'),
                ),
                make(
                    'benefits',
                    { heading: t('শিশু যা শিখবে', 'What your child learns') },
                    { style: ordered },
                ),
                make(
                    'specs',
                    { heading: t('এক নজরে', 'At a glance') },
                    {
                        blocks: [
                            { label: t('বয়স', 'Age'), value: t('৩ বছর ও তার বেশি', '3 years and up') },
                            { label: t('উপাদান', 'Material'), value: t('', '') },
                            { label: t('মাপ', 'Size'), value: t('', '') },
                        ],
                    },
                ),
                make('guarantee', {
                    heading: t('নিরাপদ উপাদান', 'Safe materials'),
                    text: t('ধারালো কোনা নেই, ক্ষতিকর রং নেই।', 'No sharp edges and no harmful paint.'),
                }),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'islamic',
        category: 'other',
        name: t('ইসলামিক পণ্য', 'Islamic products'),
        description: t(
            'আতর, জায়নামাজ বা বই: বিবরণ, উপহারের প্যাকেজিং আর প্যাক',
            'Attar, prayer mats or books: details, gift packaging and packs',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('অ্যালকোহলমুক্ত', 'Alcohol-free'),
                    t('নিজের জন্য, প্রিয়জনের জন্য', 'For yourself, or someone dear'),
                ),
                make(
                    'benefits',
                    {},
                    {
                        blocks: [
                            benefit('check', 'বিবরণ অনুযায়ী পণ্য', 'Exactly as described'),
                            benefit('gift', 'উপহারের প্যাকেজিং', 'Gift packaging'),
                            benefit('cash', 'হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
                            benefit('truck', 'সারা দেশে ডেলিভারি', 'Delivery nationwide'),
                        ],
                        style: ordered,
                    },
                ),
                story(
                    t('পণ্যটি সম্পর্কে', 'About the product'),
                    t(
                        '<p>পণ্যটি কোথা থেকে আসে, কী দিয়ে তৈরি আর কীভাবে ব্যবহার করবেন, তা এখানে লিখুন।</p>',
                        '<p>Say where it comes from, what it’s made of and how to use it.</p>',
                    ),
                ),
                make('price-packs'),
                reviews(),
                ...close(),
            ],
        }),
    },
    {
        id: 'block-offer',
        category: 'other',
        name: t('ব্লক: একটি পণ্যের অফার', 'Block: single product offer'),
        description: t(
            'শুধু হিরো, প্যাক আর অর্ডার ফর্ম: বাকিটা নিজে যোগ করুন',
            'Only a hero, packs and the order form: add the rest yourself',
        ),
        build: product => ({
            sections: [
                hero(product, t('বিশেষ অফার', 'Special offer'), t('আজই অর্ডার করুন', 'Order today')),
                make('price-packs'),
                make('order-form'),
            ],
        }),
    },
    {
        id: 'block-reviews',
        category: 'other',
        name: t('ব্লক: ক্রেতাদের মতামত দিয়ে শুরু', 'Block: reviews first'),
        description: t(
            'হিরোর নিচেই মতামতের স্ক্রিনশট, তারপর ফর্ম',
            'Review screenshots right under the hero, then the form',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('ক্রেতাদের পছন্দ', 'Buyers’ choice'),
                    t('হাজারো ক্রেতার ভরসা', 'Trusted by thousands'),
                ),
                make('testimonials', {
                    heading: t('কাস্টমাররা যা বলছেন', 'What customers say'),
                    look: 'screenshots',
                }),
                trustSales(),
                make('price-packs'),
                make('order-form'),
            ],
        }),
    },
    {
        id: 'block-video',
        category: 'other',
        name: t('ব্লক: ভিডিও দিয়ে শুরু', 'Block: video first'),
        description: t('ওপরে ভিডিও, নিচে সুবিধা আর ফর্ম', 'A video on top, then benefits and the form'),
        build: product => ({
            sections: [
                make('sales-hero', {
                    badge: t('ভিডিওতে দেখুন', 'Watch the video'),
                    headline: named(
                        product,
                        name => name,
                        name => name,
                    ),
                    highlight: t('নিজের চোখে দেখে নিন', 'See it for yourself'),
                    media: 'video',
                }),
                make('benefits', {}, { style: ordered }),
                make('price-packs'),
                make('order-form'),
            ],
        }),
    },
    {
        id: 'block-short',
        category: 'other',
        name: t('ব্লক: ছোট অর্ডার পেজ', 'Block: short order page'),
        description: t(
            'এক স্ক্রিনে পণ্য, ভরসার চিহ্ন আর ফর্ম',
            'The product, promises and the form on one screen',
        ),
        build: product => ({
            sections: [
                hero(
                    product,
                    t('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
                    t('পণ্য দেখে টাকা দিন', 'Check your order, then pay'),
                ),
                trustSales(),
                make('price-packs'),
                make('order-form'),
            ],
        }),
    },
];

export function landingTemplate(id: string): LandingTemplate | undefined {
    return LANDING_TEMPLATES.find(template => template.id === id);
}

/**
 * What a new sales page takes from its product besides the name: its video goes into the first
 * video section, and its review screenshots (phase 05's "customer feedback" images) into the first
 * reviews section, which then shows as screenshots. Sections stay hidden when the product has none.
 */
export function fillFromProduct(
    document: LayoutDocument,
    product: { video?: string | null; reviews?: ImageValue[] },
): LayoutDocument {
    let video = false;
    let reviews = false;
    const sections = document.sections.map(section => {
        if (section.type === 'video' && !video && product.video) {
            video = true;
            return readSection({
                ...section,
                hidden: false,
                settings: { ...section.settings, video: product.video },
            })!;
        }
        if (section.type === 'testimonials' && !reviews && product.reviews?.length) {
            reviews = true;
            const blocks = product.reviews.slice(0, 12).map(photo => ({ uid: newId(), settings: { photo } }));
            return readSection({
                ...section,
                hidden: false,
                settings: { ...section.settings, look: 'screenshots' },
                blocks,
            })!;
        }
        return section;
    });
    return { sections };
}

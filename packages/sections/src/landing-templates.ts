import type { LayoutDocument, SectionData } from './define';
import { createSection, newId, readSection } from './document';
import type { ImageValue } from './fields';
import type { SectionStyle } from './style';
import type { Bilingual } from './text';

/**
 * Sales page templates (roadmap phase 16): twelve ready pages for what Bangladeshi merchants sell
 * from Facebook ads. Each is ordinary sections, so everything stays editable; the product's name
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

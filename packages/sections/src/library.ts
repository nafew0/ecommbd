import type { LayoutDocument, SectionData } from './define';
import { createSection, readSection } from './document';
import type { ColumnTemplate } from './elements';
import type { NodeStyleValues } from './node-style';
import { createNode, type NodeData } from './nodes';
import type { SectionStyle } from './style';
import type { Bilingual } from './text';

/**
 * The library (roadmap phase 59): ready sections a merchant adds in one click, whole home pages
 * for each kind of store, and ready pages (About, Contact, policies). Most merchants never need
 * more than these.
 *
 * Everything here is ordinary sections and free sections, so everything stays editable. Nothing
 * picks particular products or colours: grids show the store's newest or best-selling products,
 * backgrounds come from the theme's palette, and the words are a starting point in Bangla and
 * English. Our own designs follow the storefront design standard (no gradients, square corners).
 */

export const STORE_TYPES = [
    'fashion',
    'electronics',
    'grocery',
    'food',
    'beauty',
    'footwear',
    'general',
    'islamic',
    'lifestyle',
] as const;
export type StoreType = (typeof STORE_TYPES)[number];

const t = (bn: string, en: string): Bilingual => ({ bn, en });

export const STORE_TYPE_NAMES: Record<StoreType, Bilingual> = {
    fashion: t('পোশাক', 'Fashion'),
    electronics: t('ইলেকট্রনিক্স', 'Electronics'),
    grocery: t('মুদি ও নিত্যপণ্য', 'Grocery'),
    food: t('খাবার', 'Food'),
    beauty: t('সৌন্দর্য', 'Beauty'),
    footwear: t('জুতা', 'Footwear'),
    general: t('সব ধরনের পণ্য', 'General store'),
    islamic: t('ইসলামিক পণ্য', 'Islamic store'),
    lifestyle: t('লাইফস্টাইল', 'Lifestyle'),
};

export const READY_CATEGORIES = ['basic', 'promotion', 'products', 'media', 'trust'] as const;
export type ReadyCategory = (typeof READY_CATEGORIES)[number];

export const READY_CATEGORY_NAMES: Record<ReadyCategory, Bilingual> = {
    basic: t('সাধারণ', 'Basic'),
    promotion: t('প্রচার', 'Promotion'),
    products: t('পণ্য', 'Products'),
    media: t('ছবি ও ভিডিও', 'Media'),
    trust: t('ভরসা', 'Trust'),
};

export interface ReadySection {
    id: string;
    name: Bilingual;
    description: Bilingual;
    category: ReadyCategory;
    /** The kinds of store it's written for; `all` suits any. */
    storeTypes: readonly StoreType[] | 'all';
    build(): SectionData;
}

interface Options {
    hidden?: boolean;
    style?: Partial<SectionStyle>;
    blocks?: Array<Record<string, unknown>>;
}

/** A section from its preset with some settings changed. */
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

/** A free section holding these nodes. */
function free(children: NodeData[], style: Partial<SectionStyle> = {}): SectionData {
    const base = createSection('custom');
    return readSection({ ...base, children, style: { ...base.style, ...style } })!;
}

const node = (type: string, props: Record<string, unknown> = {}, base: NodeStyleValues = {}): NodeData => ({
    ...createNode(type, props),
    style: { base },
});

function box(
    children: NodeData[],
    props: Record<string, unknown> = {},
    base: NodeStyleValues = {},
): NodeData {
    return { ...node('container', props, base), children };
}

const grid = (columns: ColumnTemplate, children: NodeData[], props: Record<string, unknown> = {}) =>
    box(children, { mode: 'grid', columns, gap: 24, ...props });

const row = (children: NodeData[], props: Record<string, unknown> = {}) =>
    box(children, { direction: 'row', gap: 12, wrap: true, stack: false, ...props });

const heading = (text: Bilingual, tag = 'h2', base: NodeStyleValues = {}) =>
    node('heading', { text, tag }, base);
const words = (bn: string, en: string, base: NodeStyleValues = {}) =>
    node('text', { text: t(`<p>${bn}</p>`, `<p>${en}</p>`) }, base);
const shop = (label: Bilingual = t('এখনই কিনুন', 'Shop now'), look = 'solid') =>
    node('button', { label, link: { type: 'search' }, look });

interface Pack {
    welcome: { badge: Bilingual; heading: Bilingual; text: Bilingual };
    collection: { heading: Bilingual; text: Bilingual; source: 'newest' | 'popular' };
    story: { heading: Bilingual; text: Bilingual };
    faq: Array<[question: Bilingual, answer: Bilingual]>;
    promise: Array<[icon: string, title: Bilingual, text: Bilingual]>;
}

const COD: [string, Bilingual, Bilingual] = [
    'cash',
    t('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
    t('দেখে টাকা দিন', 'Check, then pay'),
];
const NATIONWIDE: [string, Bilingual, Bilingual] = [
    'truck',
    t('সারা দেশে ডেলিভারি', 'Delivery all over Bangladesh'),
    t('২–৪ দিনে', 'In 2–4 days'),
];

/** The words each kind of store starts with. */
const PACKS: Record<StoreType, Pack> = {
    fashion: {
        welcome: {
            badge: t('নতুন কালেকশন', 'New collection'),
            heading: t('আপনার স্টাইল, আপনার দামে', 'Your style, at your price'),
            text: t(
                'পাঞ্জাবি, শাড়ি, থ্রি-পিস আর আরও অনেক কিছু। ক্যাশ অন ডেলিভারিতে অর্ডার করুন।',
                'Panjabi, saree, three-piece and more. Order with cash on delivery.',
            ),
        },
        collection: {
            heading: t('নতুন এসেছে', 'Just arrived'),
            text: t('এই সপ্তাহের নতুন ডিজাইন', 'This week’s new designs'),
            source: 'newest',
        },
        story: {
            heading: t('কাপড় বাছাই থেকে সেলাই, সবখানে যত্ন', 'Care in every step, from fabric to stitching'),
            text: t(
                '<p>আমরা নিজেরা কাপড় বাছাই করি আর প্রতিটি পোশাক পাঠানোর আগে দেখে নিই। মাপ নিয়ে প্রশ্ন থাকলে হোয়াটসঅ্যাপে জানান।</p>',
                '<p>We choose the fabric ourselves and check every piece before it leaves. Unsure about a size? Ask us on WhatsApp.</p>',
            ),
        },
        faq: [
            [
                t('মাপ না মিললে কী করব?', 'What if the size doesn’t fit?'),
                t(
                    'ডেলিভারির ৩ দিনের মধ্যে জানালে মাপ বদলে দিই।',
                    'Tell us within 3 days of delivery and we exchange the size.',
                ),
            ],
            [
                t('ছবির রঙের সাথে মিলবে?', 'Will the colour match the photo?'),
                t(
                    'ছবি দিনের আলোয় তোলা। স্ক্রিনভেদে রং সামান্য আলাদা দেখাতে পারে।',
                    'Photos are taken in daylight. Colours can look slightly different on some screens.',
                ),
            ],
            [
                t('কীভাবে ধোব?', 'How do I wash it?'),
                t(
                    'প্রথমবার ঠান্ডা পানিতে আলাদা করে ধুয়ে নিন।',
                    'Wash it separately in cold water the first time.',
                ),
            ],
        ],
        promise: [
            ['check', t('মাপ বদলের সুবিধা', 'Size exchange'), t('৩ দিনের মধ্যে', 'Within 3 days')],
            COD,
            NATIONWIDE,
        ],
    },
    electronics: {
        welcome: {
            badge: t('অরিজিনাল পণ্য', 'Genuine products'),
            heading: t('গ্যাজেট কিনুন নিশ্চিন্তে', 'Buy gadgets without worry'),
            text: t(
                'অফিসিয়াল ওয়ারেন্টি, যাচাই করা পণ্য আর দ্রুত ডেলিভারি।',
                'Official warranty, checked products and fast delivery.',
            ),
        },
        collection: {
            heading: t('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
            text: t('ক্রেতাদের পছন্দের গ্যাজেট', 'The gadgets buyers pick most'),
            source: 'popular',
        },
        story: {
            heading: t('পাঠানোর আগে প্রতিটি পণ্য চালিয়ে দেখি', 'We test every product before it ships'),
            text: t(
                '<p>চার্জ, ডিসপ্লে, বাটন: সব ঠিক আছে কি না দেখে তবেই প্যাক করি। ওয়ারেন্টি কার্ড বক্সেই থাকে।</p>',
                '<p>Charging, display, buttons: we check them all before packing. The warranty card is in the box.</p>',
            ),
        },
        faq: [
            [
                t('ওয়ারেন্টি কীভাবে পাব?', 'How do I claim the warranty?'),
                t(
                    'ওয়ারেন্টি কার্ড আর অর্ডার নম্বর নিয়ে আমাদের জানান। আমরা সার্ভিস সেন্টারে পাঠানোর ব্যবস্থা করি।',
                    'Contact us with the warranty card and your order number. We arrange the service centre.',
                ),
            ],
            [
                t('পণ্য কি অরিজিনাল?', 'Is it genuine?'),
                t(
                    'হ্যাঁ। আমরা অনুমোদিত পরিবেশকের কাছ থেকে পণ্য আনি।',
                    'Yes. We buy from authorised distributors.',
                ),
            ],
            [
                t('নষ্ট পণ্য পেলে কী করব?', 'What if it arrives faulty?'),
                t(
                    'ডেলিভারির সময় খুলে দেখে নিন। সমস্যা থাকলে তখনই ফেরত দিন।',
                    'Open it at delivery. If something is wrong, return it on the spot.',
                ),
            ],
        ],
        promise: [
            [
                'shield',
                t('অফিসিয়াল ওয়ারেন্টি', 'Official warranty'),
                t('ব্র্যান্ডের নিজস্ব', 'From the brand'),
            ],
            ['check', t('যাচাই করা পণ্য', 'Checked before shipping'), t('চালিয়ে দেখা', 'Tested by us')],
            ['return', t('৭ দিনে বদল', '7-day replacement'), t('ত্রুটি থাকলে', 'If it’s faulty')],
        ],
    },
    grocery: {
        welcome: {
            badge: t('প্রতিদিনের বাজার', 'Daily shopping'),
            heading: t('বাজারের ঝামেলা ছাড়াই ঘরে বাজার', 'Your groceries at home, without the market trip'),
            text: t(
                'চাল, ডাল, তেল, মসলা: সব এক জায়গায়, ন্যায্য দামে।',
                'Rice, lentils, oil, spices: all in one place, at fair prices.',
            ),
        },
        collection: {
            heading: t('প্রতিদিনের দরকারি', 'Everyday essentials'),
            text: t('যা সবচেয়ে বেশি অর্ডার হয়', 'What gets ordered most'),
            source: 'popular',
        },
        story: {
            heading: t('ওজন আর মেয়াদ দেখে প্যাক করি', 'Packed by weight, checked for date'),
            text: t(
                '<p>প্রতিটি পণ্য মেপে প্যাক করা হয়, আর মেয়াদ দেখে তবেই পাঠানো হয়।</p>',
                '<p>Everything is weighed when packed, and we check the expiry date before it leaves.</p>',
            ),
        },
        faq: [
            [
                t('ডেলিভারি চার্জ কত?', 'How much is delivery?'),
                t(
                    'ডেলিভারি চার্জ চেকআউটে দেখায়। অফার থাকলে সেখানেই বাদ যায়।',
                    'The delivery charge shows at checkout. Any offer is taken off there.',
                ),
            ],
            [
                t('একই দিনে পাব?', 'Can I get it the same day?'),
                t(
                    'ঢাকার ভেতরে দুপুরের আগের অর্ডার সাধারণত সেদিনই পৌঁছায়।',
                    'Inside Dhaka, orders before noon usually arrive the same day.',
                ),
            ],
            [
                t('পণ্য খারাপ হলে কী করব?', 'What if something is bad?'),
                t(
                    'ডেলিভারির সময় দেখে নিন। সমস্যা থাকলে সেই পণ্য ফেরত দিন।',
                    'Check at delivery. Return any item that isn’t right.',
                ),
            ],
        ],
        promise: [
            ['tag', t('ন্যায্য দাম', 'Fair prices'), t('বাজারদরে', 'At market rates')],
            [
                'clock',
                t('সময়মতো ডেলিভারি', 'On-time delivery'),
                t('আপনার সুবিধার সময়ে', 'When it suits you'),
            ],
            ['check', t('মেয়াদ দেখা পণ্য', 'Dates checked'), t('প্রতিটি প্যাকেটে', 'On every pack')],
        ],
    },
    food: {
        welcome: {
            badge: t('১০০% খাঁটি', '100% pure'),
            heading: t('খাঁটি খাবার, সরাসরি উৎস থেকে', 'Pure food, straight from the source'),
            text: t(
                'ঘি, মধু, খেজুর, বাদাম: ভেজাল ছাড়া, যত্ন করে প্যাক করা।',
                'Ghee, honey, dates, nuts: nothing added, packed with care.',
            ),
        },
        collection: {
            heading: t('ক্রেতাদের পছন্দ', 'Customer favourites'),
            text: t('যা বারবার অর্ডার হয়', 'What people order again'),
            source: 'popular',
        },
        story: {
            heading: t('আমরা নিজেরা উৎস থেকে সংগ্রহ করি', 'We collect from the source ourselves'),
            text: t(
                '<p>কোথা থেকে পণ্য আসে, কীভাবে তৈরি হয় আর কেন এটি খাঁটি, তা এখানে লিখুন।</p>',
                '<p>Say where it comes from, how it’s made and why it’s pure.</p>',
            ),
        },
        faq: [
            [
                t('খাঁটি বুঝব কীভাবে?', 'How do I know it’s pure?'),
                t(
                    'প্রতিটি ব্যাচ আমরা নিজেরা পরীক্ষা করি। পছন্দ না হলে ফেরত দিতে পারেন।',
                    'We test every batch ourselves. You can return it if you’re not happy.',
                ),
            ],
            [
                t('কতদিন ভালো থাকে?', 'How long does it keep?'),
                t(
                    'মেয়াদ প্যাকেটের গায়ে লেখা থাকে। ঠান্ডা, শুকনো জায়গায় রাখুন।',
                    'The date is on the pack. Keep it somewhere cool and dry.',
                ),
            ],
            [
                t('ঢাকার বাইরে পাঠান?', 'Do you deliver outside Dhaka?'),
                t('হ্যাঁ, সারা দেশে কুরিয়ারে পাঠাই।', 'Yes, by courier to the whole country.'),
            ],
        ],
        promise: [
            ['leaf', t('কোনো ভেজাল নেই', 'Nothing added'), t('কেমিক্যাল ছাড়া', 'No chemicals')],
            ['box', t('নিরাপদ প্যাকেজিং', 'Safe packaging'), t('ফুড-গ্রেড পাত্রে', 'Food-grade jars')],
            [
                'cash',
                t('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
                t('হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
            ],
        ],
    },
    beauty: {
        welcome: {
            badge: t('অরিজিনাল পণ্য', 'Genuine products'),
            heading: t('ত্বকের যত্নে আসল পণ্য', 'Real products for your skin'),
            text: t(
                'অনুমোদিত আমদানিকারকের কাছ থেকে আনা, মেয়াদ দেখে পাঠানো।',
                'From authorised importers, sent with the date checked.',
            ),
        },
        collection: {
            heading: t('জনপ্রিয় পণ্য', 'Popular now'),
            text: t('যেগুলো সবচেয়ে বেশি বিক্রি হচ্ছে', 'What’s selling most'),
            source: 'popular',
        },
        story: {
            heading: t('আপনার ত্বকের জন্য কোনটি', 'Which one is right for your skin'),
            text: t(
                '<p>ত্বকের ধরন অনুযায়ী কোন পণ্য মানাবে, তা এখানে লিখুন। না বুঝলে হোয়াটসঅ্যাপে জিজ্ঞেস করুন।</p>',
                '<p>Say which product suits which skin type. Not sure? Ask us on WhatsApp.</p>',
            ),
        },
        faq: [
            [
                t('পণ্য কি অরিজিনাল?', 'Is it genuine?'),
                t(
                    'হ্যাঁ। প্রতিটি পণ্যে ব্যাচ নম্বর আর মেয়াদ থাকে, মিলিয়ে নিতে পারেন।',
                    'Yes. Every product has a batch number and date you can check.',
                ),
            ],
            [
                t('আমার ত্বকে মানাবে?', 'Will it suit my skin?'),
                t(
                    'প্রথমে হাতে অল্প লাগিয়ে দেখে নিন। সমস্যা হলে ব্যবহার বন্ধ করুন।',
                    'Try a little on your hand first. Stop using it if it irritates.',
                ),
            ],
            [
                t('ফেরত দেওয়া যায়?', 'Can I return it?'),
                t('সিল না খুললে ৩ দিনের মধ্যে ফেরত নিই।', 'Within 3 days, if the seal is unopened.'),
            ],
        ],
        promise: [
            ['shield', t('১০০% অরিজিনাল', '100% genuine'), t('ব্যাচ নম্বরসহ', 'With batch number')],
            ['clock', t('মেয়াদ দেখে পাঠানো', 'Date checked'), t('প্রতিটি অর্ডারে', 'On every order')],
            ['chat', t('পরামর্শ নিন', 'Ask for advice'), t('হোয়াটসঅ্যাপে', 'On WhatsApp')],
        ],
    },
    footwear: {
        welcome: {
            badge: t('নতুন ডিজাইন', 'New designs'),
            heading: t('আরামে হাঁটুন, স্টাইলে থাকুন', 'Walk in comfort, stay in style'),
            text: t(
                'স্যান্ডেল, স্নিকার, ফরমাল: সব মাপে, সব বয়সের জন্য।',
                'Sandals, sneakers, formal: every size, for every age.',
            ),
        },
        collection: {
            heading: t('নতুন এসেছে', 'New arrivals'),
            text: t('এই মৌসুমের জুতা', 'This season’s shoes'),
            source: 'newest',
        },
        story: {
            heading: t('সঠিক মাপ বেছে নিন', 'Find your size'),
            text: t(
                '<p>পায়ের মাপ সেন্টিমিটারে মেপে আমাদের চার্টের সাথে মিলিয়ে নিন। দুই মাপের মাঝে হলে বড়টি নিন।</p>',
                '<p>Measure your foot in centimetres and match it to our chart. Between two sizes? Take the larger.</p>',
            ),
        },
        faq: [
            [
                t('মাপ না মিললে কী করব?', 'What if the size is wrong?'),
                t('না পরা অবস্থায় ৩ দিনের মধ্যে বদলে দিই।', 'We exchange it within 3 days if it’s unworn.'),
            ],
            [
                t('চামড়া কি আসল?', 'Is the leather real?'),
                t(
                    'প্রতিটি পণ্যের বিবরণে উপাদান লেখা আছে।',
                    'The material is written in each product’s details.',
                ),
            ],
            [
                t('কীভাবে যত্ন নেব?', 'How do I care for them?'),
                t(
                    'ভেজা কাপড়ে মুছে ছায়ায় শুকান। রোদে দেবেন না।',
                    'Wipe with a damp cloth and dry in the shade, not in the sun.',
                ),
            ],
        ],
        promise: [
            ['return', t('মাপ বদল', 'Size exchange'), t('৩ দিনের মধ্যে', 'Within 3 days')],
            ['check', t('দেখে টাকা দিন', 'Check, then pay'), t('পায়ে দিয়ে দেখুন', 'Try them on')],
            NATIONWIDE,
        ],
    },
    general: {
        welcome: {
            badge: t('স্বাগতম', 'Welcome'),
            heading: t('যা দরকার, এক জায়গায়', 'Everything you need, in one place'),
            text: t(
                'পছন্দের পণ্য বেছে নিন। পণ্য হাতে পেয়ে টাকা দিন।',
                'Pick what you like. Pay when it reaches you.',
            ),
        },
        collection: {
            heading: t('নতুন পণ্য', 'New products'),
            text: t('সদ্য যোগ হয়েছে', 'Just added'),
            source: 'newest',
        },
        story: {
            heading: t('আমাদের সম্পর্কে', 'About us'),
            text: t(
                '<p>কবে থেকে ব্যবসা করছেন, কী বিক্রি করেন আর কেন ক্রেতারা আপনাকে পছন্দ করেন, তা এখানে লিখুন।</p>',
                '<p>Say how long you’ve been selling, what you sell and why buyers come back.</p>',
            ),
        },
        faq: [
            [
                t('কীভাবে অর্ডার করব?', 'How do I order?'),
                t(
                    'পণ্য বেছে "এখনই কিনুন" চাপুন, তারপর নাম, মোবাইল নম্বর আর ঠিকানা দিন।',
                    'Choose a product, press "Buy now", then give your name, mobile number and address.',
                ),
            ],
            [
                t('টাকা কখন দেব?', 'When do I pay?'),
                t(
                    'পণ্য হাতে পেয়ে, দেখে তারপর টাকা দিন।',
                    'When the product reaches you, after you check it.',
                ),
            ],
            [
                t('ডেলিভারিতে কতদিন লাগে?', 'How long does delivery take?'),
                t('ঢাকার ভেতরে ১–২ দিন, বাইরে ২–৪ দিন।', '1–2 days inside Dhaka, 2–4 days outside.'),
            ],
        ],
        promise: [
            COD,
            NATIONWIDE,
            ['return', t('সহজ রিটার্ন', 'Easy returns'), t('সমস্যা হলে ফেরত দিন', 'If something’s wrong')],
        ],
    },
    islamic: {
        welcome: {
            badge: t('বিসমিল্লাহ', 'Bismillah'),
            heading: t('ইবাদতের জন্য, যত্ন করে বাছাই করা', 'Chosen with care, for your worship'),
            text: t(
                'জায়নামাজ, তসবিহ, আতর, বই আর হিজাব। সারা দেশে ডেলিভারি।',
                'Prayer mats, tasbih, attar, books and hijab. Delivered nationwide.',
            ),
        },
        collection: {
            heading: t('সবচেয়ে বেশি বিক্রি', 'Most ordered'),
            text: t('ক্রেতাদের পছন্দের পণ্য', 'What buyers choose most'),
            source: 'popular',
        },
        story: {
            heading: t('হালাল উপার্জন, সৎ ব্যবসা', 'Honest trade, halal earning'),
            text: t(
                '<p>পণ্যের বিবরণ যেমন লেখা, তেমনই পাবেন। না মিললে ফেরত নিই।</p>',
                '<p>What you receive is what we describe. If it isn’t, we take it back.</p>',
            ),
        },
        faq: [
            [
                t('আতরে কি অ্যালকোহল আছে?', 'Does the attar have alcohol?'),
                t('না, আমাদের সব আতর অ্যালকোহলমুক্ত।', 'No, all our attars are alcohol-free.'),
            ],
            [
                t('উপহারের জন্য প্যাক করে দেন?', 'Do you gift-wrap?'),
                t('হ্যাঁ, অর্ডারের নোটে লিখে দিন।', 'Yes, write it in the order note.'),
            ],
            [
                t('বইয়ের ছাপা কেমন?', 'How is the print quality?'),
                t(
                    'ছবিতে ভেতরের পাতা দেখানো আছে। আরও জানতে কল করুন।',
                    'The photos show the inside pages. Call us to know more.',
                ),
            ],
        ],
        promise: [
            ['check', t('বিবরণ অনুযায়ী পণ্য', 'As described'), t('না মিললে ফেরত', 'Or we take it back')],
            ['gift', t('উপহারের প্যাকেজিং', 'Gift packaging'), t('চাইলে', 'On request')],
            COD,
        ],
    },
    lifestyle: {
        welcome: {
            badge: t('নতুন কালেকশন', 'New in'),
            heading: t('ঘর সাজান নিজের মতো', 'Make your home your own'),
            text: t(
                'ঘর সাজানোর জিনিস, উপহার আর প্রতিদিনের ব্যবহারের পণ্য।',
                'Home décor, gifts and things for every day.',
            ),
        },
        collection: {
            heading: t('সবার পছন্দ', 'Loved by buyers'),
            text: t('যা সবচেয়ে বেশি বিক্রি হয়', 'Our best sellers'),
            source: 'popular',
        },
        story: {
            heading: t('হাতে বানানো, যত্নে গড়া', 'Handmade, with care'),
            text: t(
                '<p>কে বানান, কী দিয়ে বানান আর কেন এটি আলাদা, সেই গল্প এখানে লিখুন।</p>',
                '<p>Tell the story: who makes it, from what, and why it’s different.</p>',
            ),
        },
        faq: [
            [
                t('ভাঙা পণ্য পেলে কী করব?', 'What if it arrives broken?'),
                t(
                    'ডেলিভারির সময় খুলে দেখে নিন। ভাঙা থাকলে তখনই ফেরত দিন, আমরা নতুনটি পাঠাব।',
                    'Open it at delivery. If it’s broken, return it on the spot and we send a new one.',
                ),
            ],
            [
                t('উপহার হিসেবে পাঠানো যায়?', 'Can I send it as a gift?'),
                t(
                    'হ্যাঁ, প্রাপকের ঠিকানা দিন আর নোটে বার্তা লিখে দিন।',
                    'Yes. Give the recipient’s address and write your message in the note.',
                ),
            ],
            [
                t('মাপ কত?', 'What size is it?'),
                t('প্রতিটি পণ্যের বিবরণে মাপ লেখা আছে।', 'Sizes are in each product’s details.'),
            ],
        ],
        promise: [
            ['box', t('যত্ন করে প্যাক করা', 'Packed with care'), t('ভাঙার ভয় নেই', 'Safe from breaking')],
            ['gift', t('উপহারের জন্য তৈরি', 'Gift-ready'), t('বার্তাসহ', 'With your message')],
            ['return', t('সহজ রিটার্ন', 'Easy returns'), t('সমস্যা হলে', 'If something’s wrong')],
        ],
    },
};

/** Five sections written for one kind of store. */
function packSections(type: StoreType): ReadySection[] {
    const pack = PACKS[type];
    const name = STORE_TYPE_NAMES[type];
    const titled = (bn: string, en: string) => t(`${name.bn}: ${bn}`, `${name.en}: ${en}`);
    return [
        {
            id: `${type}-welcome`,
            name: titled('স্বাগত ব্যানার', 'welcome banner'),
            description: t('বড় ছবি, শিরোনাম আর কেনার বাটন', 'A large image, a headline and a shop button'),
            category: 'promotion',
            storeTypes: [type],
            build: () => make('hero', { ...pack.welcome, layout: 'overlay', height: 'm' }),
        },
        {
            id: `${type}-collection`,
            name: titled('পণ্যের সারি', 'product collection'),
            description: t(
                'আপনার স্টোরের আসল পণ্য। নতুন, জনপ্রিয় বা একটি ক্যাটাগরি থেকে',
                'Your store’s real products: newest, best selling or one category',
            ),
            category: 'products',
            storeTypes: [type],
            build: () =>
                make('product-grid', {
                    heading: pack.collection.heading,
                    text: pack.collection.text,
                    source: pack.collection.source,
                    count: 8,
                }),
        },
        {
            id: `${type}-story`,
            name: titled('ব্র্যান্ডের গল্প', 'brand story'),
            description: t('ছবির পাশে আপনার কথা', 'Your words beside a photo'),
            category: 'basic',
            storeTypes: [type],
            build: () => make('image-with-text', { heading: pack.story.heading, text: pack.story.text }),
        },
        {
            id: `${type}-faq`,
            name: titled('প্রশ্ন ও উত্তর', 'questions and answers'),
            description: t('ক্রেতারা যা সবচেয়ে বেশি জিজ্ঞেস করেন', 'What buyers ask most'),
            category: 'basic',
            storeTypes: [type],
            build: () =>
                make(
                    'faq',
                    { heading: t('সাধারণ প্রশ্ন', 'Common questions') },
                    { blocks: pack.faq.map(([question, answer]) => ({ question, answer })) },
                ),
        },
        {
            id: `${type}-promise`,
            name: titled('ভরসার চিহ্ন', 'our promises'),
            description: t('তিনটি কারণ, কেন আপনার কাছ থেকে কিনবে', 'Three reasons to buy from you'),
            category: 'trust',
            storeTypes: [type],
            build: () =>
                make(
                    'trust-badges',
                    {},
                    { blocks: pack.promise.map(([icon, title, text]) => ({ icon, title, text })) },
                ),
        },
    ];
}

const centred: NodeStyleValues = { textAlign: 'center' };

/** Sections that suit any store. */
const GENERAL: ReadySection[] = [
    {
        id: 'campaign-hero',
        name: t('ক্যাম্পেইন হিরো', 'Campaign hero'),
        description: t('বড় ছবির ওপর অফারের শিরোনাম', 'An offer headline on a large image'),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            make('hero', {
                badge: t('সীমিত সময়ের অফার', 'Limited-time offer'),
                heading: t('এই সপ্তাহে বিশেষ ছাড়', 'Special prices this week'),
                text: t('পছন্দের পণ্য এখনই অর্ডার করুন।', 'Order your favourites now.'),
                height: 'l',
            }),
    },
    {
        id: 'compact-hero',
        name: t('ছোট হিরো', 'Compact hero'),
        description: t('ছবির পাশে শিরোনাম আর বাটন', 'A headline and a button beside the image'),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            make('hero', {
                layout: 'split',
                heading: t('নতুন পণ্য এসেছে', 'New products are in'),
                text: t('দেখে নিন কী কী যোগ হয়েছে।', 'See what’s been added.'),
            }),
    },
    {
        id: 'slides',
        name: t('দুই স্লাইডের হিরো', 'Two-slide hero'),
        description: t('পালা করে দুটি ছবি আর শিরোনাম', 'Two images and headlines that take turns'),
        category: 'promotion',
        storeTypes: 'all',
        build: () => make('slideshow'),
    },
    {
        id: 'editorial-banner',
        name: t('মাঝখানে লেখা ব্যানার', 'Centred banner'),
        description: t(
            'ছবি ছাড়া, বড় অক্ষরে একটি কথা আর একটি বাটন',
            'No image: one line in large type and a button',
        ),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            free(
                [
                    box(
                        [
                            heading(t('যা বলতে চান, বড় করে বলুন', 'Say it large'), 'h2', {
                                fontSize: 44,
                                lineHeight: 1.15,
                            }),
                            words(
                                'এক-দুই লাইনে আপনার অফার বা নতুন খবর লিখুন।',
                                'Your offer or your news, in a line or two.',
                            ),
                            box([shop()], { align: 'center' }),
                        ],
                        { gap: 20 },
                        { ...centred, maxWidth: 720 },
                    ),
                ],
                { spacing: 'l', align: 'center' },
            ),
    },
    {
        id: 'cta-dark',
        name: t('গাঢ় কল টু অ্যাকশন', 'Dark call to action'),
        description: t('গাঢ় ব্যাকগ্রাউন্ডে শিরোনাম আর বাটন', 'A headline and a button on a dark background'),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            free(
                [
                    box(
                        [
                            heading(t('আজই অর্ডার করুন', 'Order today')),
                            words(
                                'ক্যাশ অন ডেলিভারি, সারা বাংলাদেশে।',
                                'Cash on delivery, all over Bangladesh.',
                            ),
                            box([shop(t('পণ্য দেখুন', 'See products'))], { align: 'center' }),
                        ],
                        { gap: 16 },
                        centred,
                    ),
                ],
                { background: 'dark', align: 'center' },
            ),
    },
    {
        id: 'cta-soft',
        name: t('হালকা কল টু অ্যাকশন', 'Soft call to action'),
        description: t(
            'হালকা ব্যাকগ্রাউন্ডে শিরোনাম আর দুটি বাটন',
            'A headline and two buttons on a soft background',
        ),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            free(
                [
                    box(
                        [
                            heading(t('কোনটি নেবেন বুঝতে পারছেন না?', 'Not sure which to pick?')),
                            words(
                                'আমাদের জানান, আমরা বেছে নিতে সাহায্য করব।',
                                'Tell us, and we’ll help you choose.',
                            ),
                            row(
                                [
                                    node('button', {
                                        label: t('হোয়াটসঅ্যাপ করুন', 'WhatsApp us'),
                                        link: { type: 'whatsapp' },
                                    }),
                                    node('button', {
                                        label: t('কল করুন', 'Call us'),
                                        link: { type: 'call' },
                                        look: 'outline',
                                    }),
                                ],
                                { justify: 'center' },
                            ),
                        ],
                        { gap: 16 },
                        centred,
                    ),
                ],
                { background: 'subtle', align: 'center' },
            ),
    },
    {
        id: 'cta-inline',
        name: t('এক সারিতে কল টু অ্যাকশন', 'Inline call to action'),
        description: t('বাঁয়ে একটি কথা, ডানে বাটন', 'A line on the left, a button on the right'),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            free([
                box(
                    [heading(t('নতুন কালেকশন দেখে নিন', 'See the new collection'), 'h3'), shop()],
                    { direction: 'row', justify: 'space-between', align: 'center', gap: 16, stack: true },
                    { padding: 24, borderWidth: 1, borderColor: '#d9d9d9' },
                ),
            ]),
    },
    {
        id: 'offer-banner',
        name: t('অফারের ব্যানার', 'Offer banner'),
        description: t('ছবিসহ একটি অফার, বাটন দিয়ে', 'One offer with an image and a button'),
        category: 'promotion',
        storeTypes: 'all',
        build: () => make('banner'),
    },
    {
        id: 'countdown-offer',
        name: t('সময় গোনা অফার', 'Offer with a countdown'),
        description: t('অফার শেষ হওয়ার ঘড়ি', 'A clock counting down to the end of an offer'),
        category: 'promotion',
        storeTypes: 'all',
        build: () =>
            make('countdown', {
                heading: t('অফার শেষ হতে বাকি', 'The offer ends in'),
                mode: 'evergreen',
                hours: 24,
            }),
    },
    {
        id: 'latest-products',
        name: t('নতুন পণ্যের গ্রিড', 'Latest products grid'),
        description: t('সদ্য যোগ করা আটটি পণ্য', 'The eight products added last'),
        category: 'products',
        storeTypes: 'all',
        build: () =>
            make('product-grid', { heading: t('নতুন এসেছে', 'New arrivals'), source: 'newest', count: 8 }),
    },
    {
        id: 'best-sellers',
        name: t('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
        description: t('যে চারটি পণ্য সবচেয়ে বেশি বিক্রি হয়', 'The four products that sell most'),
        category: 'products',
        storeTypes: 'all',
        build: () =>
            make('product-grid', {
                heading: t('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
                source: 'popular',
                count: 4,
            }),
    },
    {
        id: 'three-column-collection',
        name: t('তিন কলামের কালেকশন', 'Three-column collection'),
        description: t('বড় ছবিতে ছয়টি পণ্য', 'Six products with larger photos'),
        category: 'products',
        storeTypes: 'all',
        build: () =>
            make('product-grid', {
                heading: t('বাছাই করা পণ্য', 'Our picks'),
                source: 'popular',
                count: 6,
                columns: 3,
            }),
    },
    {
        id: 'category-tiles',
        name: t('ক্যাটাগরির টাইল', 'Category tiles'),
        description: t('আপনার প্রধান ক্যাটাগরিগুলো, ছবিসহ', 'Your main categories, with photos'),
        category: 'products',
        storeTypes: 'all',
        build: () => make('collection-list', { heading: t('ক্যাটাগরি', 'Shop by category') }),
    },
    {
        id: 'category-overlay',
        name: t('ছবির ওপর ক্যাটাগরির নাম', 'Categories on photos'),
        description: t('ছবির ওপর নাম লেখা বড় টাইল', 'Large tiles with the name on the photo'),
        category: 'products',
        storeTypes: 'all',
        build: () =>
            make('collection-list', {
                heading: t('কী খুঁজছেন?', 'What are you looking for?'),
                look: 'overlay',
            }),
    },
    {
        id: 'featured-product',
        name: t('একটি পণ্য সামনে আনুন', 'One product in the spotlight'),
        description: t(
            'ছবি, দাম আর কেনার বাটনসহ একটি পণ্য',
            'One product with its photo, price and buy button',
        ),
        category: 'products',
        storeTypes: 'all',
        build: () => make('featured-product', { badge: t('সবচেয়ে জনপ্রিয়', 'Best seller') }),
    },
    {
        id: 'delivery-bar',
        name: t('ডেলিভারি ও সাপোর্টের বার', 'Delivery and support bar'),
        description: t('পাশাপাশি তিনটি ছোট তথ্য, আইকনসহ', 'Three short facts side by side, with icons'),
        category: 'trust',
        storeTypes: 'all',
        build: () =>
            free(
                [
                    grid('1-1-1', [
                        box([
                            node('icon-box', {
                                icon: 'truck',
                                heading: t('সারা দেশে ডেলিভারি', 'Delivery nationwide'),
                                body: t('৬৪ জেলায়, ২–৪ দিনে।', 'All 64 districts, in 2–4 days.'),
                            }),
                        ]),
                        box([
                            node('icon-box', {
                                icon: 'cash',
                                heading: t('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
                                body: t('পণ্য দেখে টাকা দিন।', 'Check your order, then pay.'),
                            }),
                        ]),
                        box([
                            node('icon-box', {
                                icon: 'phone',
                                heading: t('ফোনে সাহায্য', 'Help by phone'),
                                body: t('কল বা হোয়াটসঅ্যাপ করুন।', 'Call or WhatsApp us.'),
                            }),
                        ]),
                    ]),
                ],
                { background: 'subtle', spacing: 's' },
            ),
    },
    {
        id: 'benefits-list',
        name: t('কেনার সুবিধার তালিকা', 'Shopping benefits list'),
        description: t('টিক চিহ্ন দেওয়া সুবিধার তালিকা', 'A ticked list of what buyers get'),
        category: 'trust',
        storeTypes: 'all',
        build: () =>
            free([
                grid(
                    '1-1',
                    [
                        box([
                            heading(t('আমাদের কাছ থেকে কেন কিনবেন', 'Why buy from us')),
                            words('ক্রেতারা যে কারণে বারবার ফিরে আসেন।', 'The reasons buyers come back.'),
                        ]),
                        box([
                            node('icon-list', {
                                items: t(
                                    'পণ্য হাতে পেয়ে টাকা\nসারা বাংলাদেশে ডেলিভারি\nসমস্যা হলে সহজে ফেরত\nফোন ও হোয়াটসঅ্যাপে সাহায্য',
                                    'Pay when it arrives\nDelivery all over Bangladesh\nEasy returns if something is wrong\nHelp by phone and WhatsApp',
                                ),
                            }),
                        ]),
                    ],
                    { align: 'center' },
                ),
            ]),
    },
    {
        id: 'trust-badges',
        name: t('ভরসার চিহ্ন', 'Trust badges'),
        description: t('আইকনসহ চারটি ছোট প্রতিশ্রুতি', 'Four short promises with icons'),
        category: 'trust',
        storeTypes: 'all',
        build: () => make('trust-badges'),
    },
    {
        id: 'customer-reviews',
        name: t('ক্রেতাদের মতামত', 'Customer reviews'),
        description: t('তারাসহ ক্রেতাদের কথা', 'What buyers said, with stars'),
        category: 'trust',
        storeTypes: 'all',
        build: () => make('testimonials', { heading: t('ক্রেতারা যা বলছেন', 'What buyers say') }),
    },
    {
        id: 'customer-story',
        name: t('একজন ক্রেতার গল্প', 'One customer’s story'),
        description: t('বড় করে একটি মতামত, তারাসহ', 'One review in large type, with stars'),
        category: 'trust',
        storeTypes: 'all',
        build: () =>
            free(
                [
                    box(
                        [
                            box([node('stars', { rating: 5 })], { align: 'center' }),
                            node(
                                'quote',
                                {
                                    text: t(
                                        'ছবিতে যেমন দেখেছি, হাতে পেয়ে ঠিক তেমনই পেয়েছি। ডেলিভারিও সময়মতো হয়েছে।',
                                        'It arrived exactly as in the photos, and on time.',
                                    ),
                                    author: t('একজন ক্রেতা, ঢাকা', 'A customer, Dhaka'),
                                },
                                { fontSize: 22 },
                            ),
                        ],
                        { gap: 16 },
                        { maxWidth: 720 },
                    ),
                ],
                { background: 'subtle' },
            ),
    },
    {
        id: 'brand-facts',
        name: t('সংখ্যায় আপনার ব্র্যান্ড', 'Your brand in numbers'),
        description: t('বড় অক্ষরে তিনটি সংখ্যা', 'Three numbers in large type'),
        category: 'trust',
        storeTypes: 'all',
        build: () => {
            const fact = (number: Bilingual, label: Bilingual) =>
                box(
                    [
                        heading(number, 'p', { fontSize: 40, fontWeight: '700' }),
                        node('text', { text: t(`<p>${label.bn}</p>`, `<p>${label.en}</p>`) }),
                    ],
                    { gap: 4 },
                    centred,
                );
            return free([
                grid('1-1-1', [
                    fact(t('৫,০০০+', '5,000+'), t('খুশি ক্রেতা', 'Happy buyers')),
                    fact(t('৬৪', '64'), t('জেলায় ডেলিভারি', 'Districts we deliver to')),
                    fact(t('৩ বছর', '3 years'), t('ধরে আপনাদের সাথে', 'Serving you')),
                ]),
            ]);
        },
    },
    {
        id: 'ordering-faq',
        name: t('অর্ডার নিয়ে প্রশ্ন', 'Ordering questions'),
        description: t(
            'অর্ডার, টাকা আর ডেলিভারি নিয়ে তিনটি উত্তর',
            'Three answers about ordering, paying and delivery',
        ),
        category: 'basic',
        storeTypes: 'all',
        build: () =>
            make(
                'faq',
                { heading: t('অর্ডার নিয়ে প্রশ্ন', 'Questions about ordering') },
                { blocks: PACKS.general.faq.map(([question, answer]) => ({ question, answer })) },
            ),
    },
    {
        id: 'how-to-shop',
        name: t('যেভাবে কিনবেন', 'How to shop'),
        description: t('তিন ধাপে কেনার নিয়ম', 'Buying, in three steps'),
        category: 'basic',
        storeTypes: 'all',
        build: () => {
            const step = (icon: string, title: Bilingual, body: Bilingual) =>
                box([node('icon-box', { icon, heading: title, body })]);
            return free([
                heading(t('যেভাবে কিনবেন', 'How to shop'), 'h2', centred),
                grid('1-1-1', [
                    step(
                        'tag',
                        t('১. পণ্য বেছে নিন', '1. Choose a product'),
                        t('পছন্দের পণ্যে "এখনই কিনুন" চাপুন।', 'Press "Buy now" on what you like.'),
                    ),
                    step(
                        'phone',
                        t('২. নাম ও ঠিকানা দিন', '2. Give your details'),
                        t('নাম, মোবাইল নম্বর আর ঠিকানা লিখুন।', 'Your name, mobile number and address.'),
                    ),
                    step(
                        'cash',
                        t('৩. হাতে পেয়ে টাকা দিন', '3. Pay on delivery'),
                        t('পণ্য দেখে তারপর টাকা দিন।', 'Check your order, then pay.'),
                    ),
                ]),
            ]);
        },
    },
    {
        id: 'long-story',
        name: t('বড় লেখা', 'Long story'),
        description: t('শিরোনামের নিচে কয়েক অনুচ্ছেদ লেখা', 'A few paragraphs under a heading'),
        category: 'basic',
        storeTypes: 'all',
        build: () =>
            make(
                'rich-text',
                {
                    heading: t('আমাদের গল্প', 'Our story'),
                    text: t(
                        '<p>কীভাবে শুরু হলো, কী বিশ্বাস করেন আর ক্রেতাদের কী দিতে চান, তা এখানে লিখুন।</p><p>ছোট অনুচ্ছেদে লিখলে ফোনে পড়তে সুবিধা হয়।</p>',
                        '<p>Say how it began, what you believe in and what you want to give your buyers.</p><p>Short paragraphs are easier to read on a phone.</p>',
                    ),
                },
                { style: { width: 'narrow' } },
            ),
    },
    {
        id: 'story-reversed',
        name: t('লেখার পাশে ছবি', 'Photo beside words'),
        description: t('বাঁয়ে লেখা, ডানে ছবি', 'Words on the left, a photo on the right'),
        category: 'basic',
        storeTypes: 'all',
        build: () => make('image-with-text', { imagePosition: 'right' }),
    },
    {
        id: 'feature-columns',
        name: t('তিন কলামে সুবিধা', 'Features in three columns'),
        description: t('ছবি বা আইকনসহ তিনটি কলাম', 'Three columns with an image or an icon each'),
        category: 'basic',
        storeTypes: 'all',
        build: () => make('multicolumn'),
    },
    {
        id: 'delivery-info',
        name: t('ডেলিভারির তথ্য', 'Delivery information'),
        description: t('কোন এলাকায় কত চার্জ আর কতদিন', 'The charge and the time for each area'),
        category: 'basic',
        storeTypes: 'all',
        build: () => make('delivery-info'),
    },
    {
        id: 'contact',
        name: t('যোগাযোগ', 'Contact'),
        description: t('ফোন, হোয়াটসঅ্যাপ, ঠিকানা আর সময়', 'Phone, WhatsApp, address and hours'),
        category: 'basic',
        storeTypes: 'all',
        build: () => make('contact'),
    },
    {
        id: 'whatsapp',
        name: t('হোয়াটসঅ্যাপে অর্ডার', 'Order on WhatsApp'),
        description: t('হোয়াটসঅ্যাপ আর কলের বাটন', 'WhatsApp and call buttons'),
        category: 'basic',
        storeTypes: 'all',
        build: () => make('whatsapp-cta'),
    },
    {
        id: 'lookbook-square',
        name: t('বর্গাকার লুকবুক', 'Square lookbook'),
        description: t('সমান মাপের ছবির গ্রিড', 'A grid of square photos'),
        category: 'media',
        storeTypes: 'all',
        build: () => make('image-grid', { heading: t('লুকবুক', 'Lookbook'), shape: 'square' }),
    },
    {
        id: 'lookbook-portrait',
        name: t('খাড়া লুকবুক', 'Portrait lookbook'),
        description: t('খাড়া ছবির গ্রিড, পোশাকের জন্য ভালো', 'A grid of tall photos, good for clothing'),
        category: 'media',
        storeTypes: ['fashion', 'footwear', 'beauty', 'lifestyle'],
        build: () =>
            make('image-grid', { heading: t('নতুন লুক', 'New looks'), shape: 'portrait', columns: 3 }),
    },
    {
        id: 'video',
        name: t('ভিডিও', 'Video'),
        description: t(
            'ইউটিউব বা ফেসবুকের ভিডিও, চালালে তবেই লোড হয়',
            'A YouTube or Facebook video that loads when played',
        ),
        category: 'media',
        storeTypes: 'all',
        build: () => make('video', { heading: t('ভিডিওতে দেখুন', 'Watch the video') }),
    },
    {
        id: 'photo-and-points',
        name: t('ছবির পাশে পয়েন্ট', 'Photo with points'),
        description: t(
            'বাঁয়ে ছবি, ডানে শিরোনাম আর টিক চিহ্নের তালিকা',
            'A photo on the left, a heading and a ticked list on the right',
        ),
        category: 'media',
        storeTypes: 'all',
        build: () =>
            free([
                grid(
                    '1-1',
                    [
                        box([node('image')]),
                        box([
                            heading(t('পণ্যটি কেন আলাদা', 'What makes it different')),
                            node('icon-list', {
                                items: t(
                                    'প্রথম কারণ লিখুন\nদ্বিতীয় কারণ লিখুন\nতৃতীয় কারণ লিখুন',
                                    'Write the first reason\nWrite the second reason\nWrite the third reason',
                                ),
                            }),
                            box([shop()], { align: 'start' }),
                        ]),
                    ],
                    { align: 'center', gap: 32 },
                ),
            ]),
    },
];

/** Every ready section: five for each kind of store, then those that suit any. */
export const READY_SECTIONS: readonly ReadySection[] = [...STORE_TYPES.flatMap(packSections), ...GENERAL];

export function readySection(id: string): ReadySection | undefined {
    return READY_SECTIONS.find(item => item.id === id);
}

/** The ready sections for a kind of store (and those for any store) and a category. */
export function readySectionsFor(
    storeType: StoreType | 'all',
    category: ReadyCategory | 'all',
): ReadySection[] {
    return READY_SECTIONS.filter(
        item =>
            (storeType === 'all' || item.storeTypes === 'all' || item.storeTypes.includes(storeType)) &&
            (category === 'all' || item.category === category),
    );
}

export interface StoreInfo {
    name: string;
    description: string;
}

export interface StoreDesign {
    id: string;
    /** The kind of store it's made for; `any` suits every store. */
    storeType: StoreType | 'any';
    name: Bilingual;
    description: Bilingual;
    build(store: StoreInfo): LayoutDocument;
}

const ready = (id: string) => readySection(id)!.build();

/** The store's own name over a design's welcome, when it has one. */
function named(section: SectionData, store: StoreInfo): SectionData {
    if (section.type !== 'hero' || !store.description) return section;
    return { ...section, settings: { ...section.settings, text: t(store.description, store.description) } };
}

/** A home page for one kind of store, from its five sections and a few that suit any. */
function storeHome(type: StoreType): StoreDesign {
    return {
        id: `${type}-home`,
        storeType: type,
        name: t(`${STORE_TYPE_NAMES[type].bn}ের হোম পেজ`, `${STORE_TYPE_NAMES[type].en} home page`),
        description: t(
            'স্বাগত ব্যানার, ক্যাটাগরি, পণ্য, আপনার গল্প, ভরসার চিহ্ন আর প্রশ্ন-উত্তর',
            'A welcome banner, categories, products, your story, promises and questions',
        ),
        build: store => ({
            sections: [
                named(ready(`${type}-welcome`), store),
                ready('category-tiles'),
                ready(`${type}-collection`),
                ready(`${type}-promise`),
                ready(`${type}-story`),
                ready(PACKS[type].collection.source === 'newest' ? 'best-sellers' : 'latest-products'),
                ready(`${type}-faq`),
                ready('whatsapp'),
            ],
        }),
    };
}

export const STORE_DESIGNS: readonly StoreDesign[] = [
    ...STORE_TYPES.filter(type => type !== 'general').map(storeHome),
    {
        ...storeHome('general'),
        id: 'any-store',
        storeType: 'any',
        name: t('যেকোনো স্টোর', 'Any store'),
    },
    {
        id: 'grocery-market',
        storeType: 'grocery',
        name: t('মুদির বাজার', 'Grocery market'),
        description: t(
            'ছোট হিরো, ডেলিভারির বার, ক্যাটাগরি আর দুই সারি পণ্য: তাড়াতাড়ি বাজার করার জন্য',
            'A compact hero, a delivery bar, categories and two rows of products: for quick shopping',
        ),
        build: store => ({
            sections: [
                named(
                    {
                        ...ready('grocery-welcome'),
                        settings: { ...ready('grocery-welcome').settings, layout: 'split' },
                    },
                    store,
                ),
                ready('delivery-bar'),
                ready('category-overlay'),
                ready('grocery-collection'),
                ready('latest-products'),
                ready('delivery-info'),
                ready('grocery-faq'),
            ],
        }),
    },
    {
        id: 'fashion-lookbook',
        storeType: 'fashion',
        name: t('পোশাকের লুকবুক', 'Fashion lookbook'),
        description: t(
            'বড় ছবি, খাড়া লুকবুক, নতুন পোশাক আর ক্রেতাদের মতামত',
            'Large photos, a portrait lookbook, new arrivals and reviews',
        ),
        build: store => ({
            sections: [
                named(
                    {
                        ...ready('fashion-welcome'),
                        settings: { ...ready('fashion-welcome').settings, height: 'l' },
                    },
                    store,
                ),
                ready('lookbook-portrait'),
                ready('fashion-collection'),
                ready('editorial-banner'),
                ready('three-column-collection'),
                { ...ready('customer-reviews'), hidden: true },
                ready('fashion-promise'),
                ready('cta-soft'),
            ],
        }),
    },
];

export function storeDesign(id: string): StoreDesign | undefined {
    return STORE_DESIGNS.find(item => item.id === id);
}

export interface PageDesign {
    id: string;
    name: Bilingual;
    description: Bilingual;
    build(store: StoreInfo): LayoutDocument;
}

const page = (headingText: Bilingual, bn: string, en: string) =>
    make('rich-text', { heading: headingText, text: t(bn, en) }, { style: { width: 'narrow' } });

/** Ready pages. The words are a start: a merchant reads them and makes them true for their store. */
export const PAGE_DESIGNS: readonly PageDesign[] = [
    {
        id: 'about',
        name: t('আমাদের সম্পর্কে', 'About us'),
        description: t(
            'আপনার গল্প, ছবি, ভরসার চিহ্ন আর যোগাযোগ',
            'Your story, a photo, promises and contact',
        ),
        build: () => ({
            sections: [
                ready('general-story'),
                ready('brand-facts'),
                ready('general-promise'),
                ready('contact'),
            ],
        }),
    },
    {
        id: 'contact',
        name: t('যোগাযোগ', 'Contact us'),
        description: t(
            'ফোন, হোয়াটসঅ্যাপ, ঠিকানা আর খোলা থাকার সময়',
            'Phone, WhatsApp, address and opening hours',
        ),
        build: () => ({ sections: [ready('contact'), ready('cta-soft')] }),
    },
    {
        id: 'faq',
        name: t('সাহায্য ও প্রশ্ন-উত্তর', 'Help and FAQ'),
        description: t(
            'অর্ডার, টাকা, ডেলিভারি আর ফেরত নিয়ে প্রশ্ন',
            'Questions about ordering, paying, delivery and returns',
        ),
        build: () => ({ sections: [ready('how-to-shop'), ready('ordering-faq'), ready('whatsapp')] }),
    },
    {
        id: 'privacy',
        name: t('প্রাইভেসি পলিসি', 'Privacy policy'),
        description: t('ক্রেতার কোন তথ্য নেন আর কেন', 'What you collect from buyers, and why'),
        build: store => ({
            sections: [
                page(
                    t('প্রাইভেসি পলিসি', 'Privacy policy'),
                    `<p>${store.name} আপনার অর্ডার পৌঁছে দিতে আপনার নাম, মোবাইল নম্বর আর ঠিকানা নেয়।</p><p>এই তথ্য আমরা শুধু অর্ডার নিশ্চিত করতে, ডেলিভারি দিতে আর অর্ডার নিয়ে আপনার সাথে যোগাযোগ করতে ব্যবহার করি। ডেলিভারির জন্য কুরিয়ার কোম্পানিকে আপনার নাম, নম্বর আর ঠিকানা দেওয়া হয়।</p><p>আমরা আপনার তথ্য বিক্রি করি না। আপনার তথ্য দেখতে, ঠিক করতে বা মুছে ফেলতে চাইলে আমাদের সাথে যোগাযোগ করুন।</p>`,
                    `<p>${store.name} takes your name, mobile number and address to deliver your order.</p><p>We use them only to confirm your order, deliver it and contact you about it. Your name, number and address are given to the courier company for delivery.</p><p>We do not sell your details. To see, correct or delete them, contact us.</p>`,
                ),
            ],
        }),
    },
    {
        id: 'terms',
        name: t('শর্তাবলি', 'Terms and conditions'),
        description: t(
            'অর্ডার, দাম আর দায়িত্ব নিয়ে নিয়ম',
            'The rules for orders, prices and responsibility',
        ),
        build: store => ({
            sections: [
                page(
                    t('শর্তাবলি', 'Terms and conditions'),
                    `<p>${store.name}-এ অর্ডার করলে আপনি নিচের শর্তগুলো মেনে নিচ্ছেন।</p><p><strong>অর্ডার:</strong> অর্ডারের পর আমরা ফোনে নিশ্চিত করি। যোগাযোগ করা না গেলে অর্ডার বাতিল হতে পারে।</p><p><strong>দাম:</strong> সব দাম টাকায়। ডেলিভারি চার্জ চেকআউটে আলাদা করে দেখায়।</p><p><strong>পণ্য:</strong> ছবির সাথে রং সামান্য আলাদা হতে পারে। স্টক না থাকলে আমরা আপনাকে জানাই।</p>`,
                    `<p>By ordering from ${store.name} you accept these terms.</p><p><strong>Orders:</strong> we confirm each order by phone. If we can’t reach you, the order may be cancelled.</p><p><strong>Prices:</strong> all prices are in taka. The delivery charge shows separately at checkout.</p><p><strong>Products:</strong> colours can differ slightly from the photos. If something is out of stock, we tell you.</p>`,
                ),
            ],
        }),
    },
    {
        id: 'shipping',
        name: t('শিপিং ও ডেলিভারি', 'Shipping and delivery'),
        description: t('কোন এলাকায় কত চার্জ, কতদিনে পৌঁছায়', 'The charge and the time for each area'),
        build: () => ({
            sections: [
                ready('delivery-info'),
                page(
                    t('ডেলিভারি সম্পর্কে', 'About delivery'),
                    '<p>অর্ডার নিশ্চিত হওয়ার পর আমরা পণ্য কুরিয়ারে দিই। কুরিয়ার থেকে আপনাকে কল করা হবে।</p><p>ডেলিভারির সময় পণ্য দেখে নিন। সমস্যা থাকলে তখনই ডেলিভারিম্যানকে জানান।</p>',
                    '<p>Once your order is confirmed we hand it to the courier, who calls you before delivery.</p><p>Check your order when it arrives. If something is wrong, tell the delivery person then.</p>',
                ),
                ready('whatsapp'),
            ],
        }),
    },
    {
        id: 'returns',
        name: t('রিটার্ন ও রিফান্ড', 'Returns and refunds'),
        description: t('কখন আর কীভাবে পণ্য ফেরত নেন', 'When and how you take products back'),
        build: () => ({
            sections: [
                page(
                    t('রিটার্ন ও রিফান্ড', 'Returns and refunds'),
                    '<p><strong>ডেলিভারির সময়:</strong> পণ্য দেখে নিন। ভুল বা নষ্ট পণ্য হলে তখনই ফেরত দিন, কোনো টাকা দিতে হবে না।</p><p><strong>পরে:</strong> ডেলিভারির ৩ দিনের মধ্যে আমাদের জানান। অব্যবহৃত পণ্য, আসল প্যাকেটসহ ফেরত নিই।</p><p><strong>রিফান্ড:</strong> পণ্য আমাদের হাতে পৌঁছানোর পর ৭ কর্মদিবসের মধ্যে বিকাশ বা নগদে টাকা ফেরত দিই।</p>',
                    '<p><strong>At delivery:</strong> check your order. If it is wrong or damaged, return it on the spot and pay nothing.</p><p><strong>Later:</strong> tell us within 3 days of delivery. We take back unused products in their original packaging.</p><p><strong>Refunds:</strong> once the product reaches us, we refund by bKash or Nagad within 7 working days.</p>',
                ),
                ready('whatsapp'),
            ],
        }),
    },
    {
        id: 'size-guide',
        name: t('সাইজ গাইড', 'Size guide'),
        description: t('মাপের চার্ট আর মাপ নেওয়ার নিয়ম', 'A size chart and how to measure'),
        build: () => ({
            sections: [
                make(
                    'specs',
                    { heading: t('মাপের চার্ট', 'Size chart'), look: 'table' },
                    {
                        blocks: [
                            { label: t('S', 'S'), value: t('বুক ৩৬", লম্বা ২৬"', 'Chest 36", length 26"') },
                            { label: t('M', 'M'), value: t('বুক ৩৮", লম্বা ২৭"', 'Chest 38", length 27"') },
                            { label: t('L', 'L'), value: t('বুক ৪০", লম্বা ২৮"', 'Chest 40", length 28"') },
                            { label: t('XL', 'XL'), value: t('বুক ৪২", লম্বা ২৯"', 'Chest 42", length 29"') },
                        ],
                    },
                ),
                page(
                    t('মাপ নেবেন যেভাবে', 'How to measure'),
                    '<p>একটি ভালো ফিটিংয়ের পোশাক সমান জায়গায় রেখে ফিতা দিয়ে মাপুন। দুই মাপের মাঝে হলে বড়টি নিন।</p><p>বুঝতে না পারলে হোয়াটসঅ্যাপে আপনার উচ্চতা আর ওজন জানান, আমরা মাপ বলে দেব।</p>',
                    '<p>Lay a garment that fits you well on a flat surface and measure it with a tape. Between two sizes? Take the larger.</p><p>Not sure? Send us your height and weight on WhatsApp and we’ll suggest a size.</p>',
                ),
                ready('whatsapp'),
            ],
        }),
    },
];

export function pageDesign(id: string): PageDesign | undefined {
    return PAGE_DESIGNS.find(item => item.id === id);
}

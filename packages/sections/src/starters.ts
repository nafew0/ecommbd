import type { LayoutDocument, SectionData } from './define';
import { createSection, readSection } from './document';
import type { SectionStyle } from './style';
import type { Bilingual } from './text';

/**
 * Starter layouts (roadmap phase 15) for common Bangladeshi niches. A merchant applies one, then
 * edits it. They pick no particular products: grids show the newest or best-selling products and
 * the category list shows the main categories, so a starter fills itself from the store's own
 * catalogue. Sections that need the merchant's own content (reviews, a video) start hidden.
 */

export const STARTERS = ['fashion', 'food', 'gadgets', 'cosmetics'] as const;
export type StarterName = (typeof STARTERS)[number];

export const STARTER_INFO: Record<StarterName, { name: Bilingual; description: Bilingual }> = {
    fashion: {
        name: { bn: 'পোশাক', en: 'Fashion' },
        description: {
            bn: 'পাঞ্জাবি, শাড়ি, থ্রি-পিস: বড় ছবি, ক্যাটাগরি, নতুন আর জনপ্রিয় পণ্য',
            en: 'Panjabi, saree, three-piece: large photos, categories, new and popular products',
        },
    },
    food: {
        name: { bn: 'খাবার', en: 'Food' },
        description: {
            bn: 'ঘি, মধু, খেজুর: খাঁটি পণ্যের গল্প, ডেলিভারির তথ্য আর প্রশ্ন-উত্তর',
            en: 'Ghee, honey, dates: your purity story, delivery details and questions',
        },
    },
    gadgets: {
        name: { bn: 'গ্যাজেট', en: 'Gadgets' },
        description: {
            bn: 'স্লাইডশো, ক্যাটাগরি, ওয়ারেন্টি আর ডেমো ভিডিও',
            en: 'A slideshow, categories, warranty points and a demo video',
        },
    },
    cosmetics: {
        name: { bn: 'প্রসাধনী', en: 'Cosmetics' },
        description: {
            bn: 'জনপ্রিয় পণ্য, উপাদানের গল্প, কাস্টমারের মতামত আর খাঁটি পণ্যের নিশ্চয়তা',
            en: 'Best sellers, an ingredients story, customer reviews and proof it’s genuine',
        },
    },
};

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

const text = (bn: string, en: string): Bilingual => ({ bn, en });

const STARTER_SECTIONS: Record<StarterName, () => SectionData[]> = {
    fashion: () => [
        make('hero', {
            badge: text('নতুন', 'New'),
            heading: text('ঈদের নতুন কালেকশন', 'The new Eid collection'),
            text: text(
                'পছন্দের ডিজাইন বেছে নিন, ক্যাশ অন ডেলিভারিতে।',
                'Pick your favourite designs, cash on delivery.',
            ),
            height: 'l',
        }),
        make('collection-list'),
        make('product-grid', { heading: text('নতুন এসেছে', 'New arrivals'), source: 'newest', count: 8 }),
        make('banner'),
        make('product-grid', {
            heading: text('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
            source: 'popular',
            count: 4,
        }),
        make('image-with-text', {
            heading: text('যত্ন করে তৈরি', 'Made with care'),
            text: text(
                '<p>আমাদের প্রতিটি পোশাক বাছাই করা কাপড়ে, যত্ন নিয়ে তৈরি। মাপ নিয়ে প্রশ্ন থাকলে হোয়াটসঅ্যাপে জিজ্ঞেস করুন।</p>',
                '<p>Every piece is made from chosen fabric, with care. Ask us on WhatsApp if you’re unsure about a size.</p>',
            ),
        }),
        make('testimonials', {}, { hidden: true }),
        make('trust-badges'),
        make('whatsapp-cta'),
    ],
    food: () => [
        make('hero', {
            layout: 'split',
            heading: text('খাঁটি পণ্য, সরাসরি আপনার দরজায়', 'Pure food, straight to your door'),
            text: text(
                'ভেজালমুক্ত, যত্ন করে প্যাক করা। পণ্য দেখে টাকা দিন।',
                'Unadulterated and carefully packed. Check your order before you pay.',
            ),
        }),
        make(
            'trust-badges',
            {},
            {
                blocks: [
                    {
                        icon: 'leaf',
                        title: text('১০০% খাঁটি', '100% pure'),
                        text: text('কোনো ভেজাল নেই', 'Nothing added'),
                    },
                    {
                        icon: 'cash',
                        title: text('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
                        text: text('হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
                    },
                    {
                        icon: 'box',
                        title: text('নিরাপদ প্যাকেজিং', 'Safe packaging'),
                        text: text('ভাঙবে না, ছড়াবে না', 'No leaks, no breakage'),
                    },
                    {
                        icon: 'return',
                        title: text('সন্তুষ্ট না হলে ফেরত', 'Not happy? Return it'),
                        text: text('কোনো ঝামেলা ছাড়া', 'No hassle'),
                    },
                ],
            },
        ),
        make('product-grid', {
            heading: text('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
            source: 'popular',
            count: 8,
        }),
        make('image-with-text', {
            heading: text('কীভাবে আমরা সংগ্রহ করি', 'How we source'),
            text: text(
                '<p>সরাসরি খামার আর চাষিদের কাছ থেকে সংগ্রহ করে নিজেরা পরীক্ষা করি। আসল আর নকল চেনার উপায়ও এখানে লিখতে পারেন।</p>',
                '<p>We buy straight from farms and growers and check every batch ourselves. You can also explain how to tell the real thing from fakes here.</p>',
            ),
            imagePosition: 'right',
        }),
        make('delivery-info'),
        make('testimonials', {}, { hidden: true }),
        make('faq'),
        make('whatsapp-cta'),
    ],
    gadgets: () => [
        make(
            'slideshow',
            {},
            {
                blocks: [
                    {
                        heading: text('নতুন গ্যাজেট এসেছে', 'New gadgets are in'),
                        button: text('দেখুন', 'Shop now'),
                        link: { type: 'search' },
                    },
                    {
                        heading: text('অফিসিয়াল ওয়ারেন্টি', 'Official warranty'),
                        button: text('অর্ডার করুন', 'Order now'),
                        link: { type: 'search' },
                    },
                ],
            },
        ),
        make('collection-list', { look: 'overlay' }),
        make('product-grid', {
            heading: text('নতুন এসেছে', 'New arrivals'),
            source: 'newest',
            count: 10,
            columns: 5,
        }),
        make(
            'multicolumn',
            { heading: text('কেন আমাদের কাছ থেকে কিনবেন', 'Why buy from us') },
            {
                blocks: [
                    {
                        icon: 'shield',
                        title: text('ওয়ারেন্টি', 'Warranty'),
                        text: text('প্রতিটি পণ্যে লেখা আছে', 'Stated on every product'),
                    },
                    {
                        icon: 'check',
                        title: text('আসল পণ্য', 'Genuine products'),
                        text: text('যা দেখছেন, তা-ই পাবেন', 'What you see is what you get'),
                    },
                    {
                        icon: 'truck',
                        title: text('দ্রুত ডেলিভারি', 'Fast delivery'),
                        text: text('সারা বাংলাদেশে', 'All over Bangladesh'),
                    },
                ],
            },
        ),
        make('video', { heading: text('কীভাবে কাজ করে দেখুন', 'See how it works') }, { hidden: true }),
        make('product-grid', {
            heading: text('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
            source: 'popular',
            count: 5,
            columns: 5,
        }),
        make('contact'),
    ],
    cosmetics: () => [
        make('hero', {
            layout: 'split',
            badge: text('১০০% অরিজিনাল', '100% original'),
            heading: text('আপনার ত্বকের যত্নে খাঁটি পণ্য', 'Genuine care for your skin'),
            text: text('আসল পণ্যের নিশ্চয়তা, ক্যাশ অন ডেলিভারি।', 'Guaranteed genuine, cash on delivery.'),
        }),
        make('product-grid', {
            heading: text('সবচেয়ে বেশি বিক্রি', 'Best sellers'),
            source: 'popular',
            count: 8,
        }),
        make('image-with-text', {
            heading: text('কী আছে ভেতরে', 'What’s inside'),
            text: text(
                '<p>প্রধান উপাদানগুলো আর কীভাবে ব্যবহার করবেন, তা এখানে লিখুন।</p>',
                '<p>Describe the key ingredients and how to use the product here.</p>',
            ),
        }),
        make('testimonials', { look: 'screenshots' }, { hidden: true }),
        make(
            'trust-badges',
            {},
            {
                blocks: [
                    {
                        icon: 'shield',
                        title: text('১০০% অরিজিনাল', '100% original'),
                        text: text('আসল পণ্যের নিশ্চয়তা', 'Guaranteed genuine'),
                    },
                    {
                        icon: 'cash',
                        title: text('ক্যাশ অন ডেলিভারি', 'Cash on delivery'),
                        text: text('হাতে পেয়ে টাকা দিন', 'Pay when it arrives'),
                    },
                    {
                        icon: 'return',
                        title: text('সহজ রিটার্ন', 'Easy returns'),
                        text: text('সমস্যা হলে ফেরত দিন', 'Return it if something’s wrong'),
                    },
                ],
            },
        ),
        make('product-grid', { heading: text('নতুন এসেছে', 'New arrivals'), source: 'newest', count: 4 }),
        make('faq'),
        make('whatsapp-cta'),
    ],
};

/** A starter layout with new section IDs. */
export function starterLayout(name: StarterName): LayoutDocument {
    return { sections: STARTER_SECTIONS[name]() };
}

/**
 * The home page before the merchant has designed one: the store's name and description, the main
 * categories, the newest products and the trust badges.
 */
export function defaultHomeLayout(store: { name: Bilingual; description: Bilingual }): LayoutDocument {
    return {
        sections: [
            make(
                'hero',
                {
                    heading: store.name,
                    text: store.description,
                    badge: text('', ''),
                    height: 's',
                    secondButton: text('', ''),
                },
                { style: { background: 'subtle' } },
            ),
            make('collection-list'),
            make('product-grid', { heading: text('নতুন এসেছে', 'New arrivals'), source: 'newest', count: 8 }),
            make('trust-badges'),
        ],
    };
}

/** Product pages before the merchant has added sections below the product. */
export function defaultProductTemplate(): LayoutDocument {
    return { sections: [] };
}

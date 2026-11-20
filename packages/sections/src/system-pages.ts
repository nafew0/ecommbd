import {
    type LayoutDocument,
    type LayoutType,
    type SectionData,
    SYSTEM_LAYOUTS,
    type SystemLayout,
} from './define';
import { createSection } from './document';
import type { Bilingual } from './text';

/** The section type that marks where a system page's own part goes. */
export const PAGE_CONTENT = 'page-content';

export interface SystemPage {
    /** The page's name in the editor and on the Online store overview. */
    name: Bilingual;
    /** What it is for, in one line. */
    description: Bilingual;
    /** The locked block's name on this page. */
    block: Bilingual;
    /** What the locked block shows. */
    blockHint: Bilingual;
    /**
     * False for the header and footer: without their block the store's own header (or footer) is
     * gone and the merchant's sections stand in for it. Everywhere else the block must be there.
     */
    required: boolean;
}

/** The system pages, in the order the Online store overview lists them. */
export const SYSTEM_PAGES: Record<SystemLayout, SystemPage> = {
    header: {
        name: { en: 'Header', bn: 'হেডার' },
        description: { en: 'The top of every page', bn: 'প্রতিটি পেজের উপরের অংশ' },
        block: { en: 'Store header', bn: 'স্টোরের হেডার' },
        blockHint: {
            en: 'Your logo, menu, search box and cart. Remove it to build your own header from elements.',
            bn: 'আপনার লোগো, মেনু, সার্চ বক্স ও কার্ট। নিজের মতো হেডার বানাতে চাইলে এটি সরিয়ে এলিমেন্ট দিয়ে বানান।',
        },
        required: false,
    },
    footer: {
        name: { en: 'Footer', bn: 'ফুটার' },
        description: { en: 'The bottom of every page', bn: 'প্রতিটি পেজের নিচের অংশ' },
        block: { en: 'Store footer', bn: 'স্টোরের ফুটার' },
        blockHint: {
            en: 'Your contact details, links and payment marks. Remove it to build your own footer from elements.',
            bn: 'আপনার যোগাযোগের তথ্য, লিংক ও পেমেন্টের চিহ্ন। নিজের মতো ফুটার বানাতে চাইলে এটি সরিয়ে এলিমেন্ট দিয়ে বানান।',
        },
        required: false,
    },
    product: {
        name: { en: 'Product page', bn: 'পণ্যের পেজ' },
        description: { en: 'Every product’s page', bn: 'প্রতিটি পণ্যের পেজ' },
        block: { en: 'Product block', bn: 'পণ্যের ব্লক' },
        blockHint: {
            en: 'The product’s photos, name, price, options and the buy buttons.',
            bn: 'পণ্যের ছবি, নাম, দাম, অপশন ও কেনার বাটন।',
        },
        required: true,
    },
    listing: {
        name: { en: 'Category and search pages', bn: 'ক্যাটাগরি ও সার্চ পেজ' },
        description: {
            en: 'Categories, brands and search results',
            bn: 'ক্যাটাগরি, ব্র্যান্ড ও সার্চের ফলাফল',
        },
        block: { en: 'Product list', bn: 'পণ্যের তালিকা' },
        blockHint: {
            en: 'The products with their filters, sorting and page numbers.',
            bn: 'পণ্য, সাথে ফিল্টার, সাজানো ও পেজ নম্বর।',
        },
        required: true,
    },
    cart: {
        name: { en: 'Cart', bn: 'কার্ট' },
        description: { en: 'What the shopper is about to buy', bn: 'ক্রেতা যা কিনতে যাচ্ছেন' },
        block: { en: 'Cart items', bn: 'কার্টের পণ্য' },
        blockHint: {
            en: 'The items, the total and the checkout button.',
            bn: 'পণ্য, মোট দাম ও চেকআউট বাটন।',
        },
        required: true,
    },
    checkout: {
        name: { en: 'Checkout', bn: 'চেকআউট' },
        description: { en: 'Where the order is placed', bn: 'যেখানে অর্ডার করা হয়' },
        block: { en: 'Checkout form', bn: 'চেকআউট ফর্ম' },
        blockHint: {
            en: 'The address, delivery, payment and confirmation steps. They can’t be changed or reordered.',
            bn: 'ঠিকানা, ডেলিভারি, পেমেন্ট ও নিশ্চিত করার ধাপ। এগুলো বদলানো বা আগে-পরে করা যায় না।',
        },
        required: true,
    },
    thanks: {
        name: { en: 'Thank-you page', bn: 'ধন্যবাদ পেজ' },
        description: { en: 'Shown after an order', bn: 'অর্ডারের পরে দেখানো হয়' },
        block: { en: 'Order receipt', bn: 'অর্ডারের রসিদ' },
        blockHint: {
            en: 'The order number, what was ordered and what happens next.',
            bn: 'অর্ডার নম্বর, কী অর্ডার হয়েছে এবং এরপর কী হবে।',
        },
        required: true,
    },
};

export function isSystemLayout(type: string): type is SystemLayout {
    return (SYSTEM_LAYOUTS as readonly string[]).includes(type);
}

/** True for the pages that can't be published without their block. */
export function needsPageContent(type: LayoutType | string): boolean {
    return isSystemLayout(type) && SYSTEM_PAGES[type].required;
}

export function hasPageContent(document: LayoutDocument): boolean {
    return document.sections.some(section => section.type === PAGE_CONTENT && !section.hidden);
}

/** A system page as it starts: its own part and nothing else. */
export function defaultSystemLayout(): LayoutDocument {
    return { sections: [createSection(PAGE_CONTENT)] };
}

/**
 * The document with its block, added at the top when there is none (a product page template from
 * before phase 60 had only the sections below the product).
 */
export function withPageContent(document: LayoutDocument): LayoutDocument {
    if (document.sections.some(section => section.type === PAGE_CONTENT)) return document;
    return { sections: [createSection(PAGE_CONTENT), ...document.sections] };
}

export interface SplitLayout {
    /** Sections above the page's own part. */
    before: SectionData[];
    /** The block itself; null when there is none (shown, that is). */
    content: SectionData | null;
    after: SectionData[];
}

/**
 * A system page's sections around its own part. Only the first block counts; with none, all the
 * sections go below (`contentFirst`, the pages that need one) or stand alone (header, footer).
 */
export function splitAtContent(document: LayoutDocument): SplitLayout {
    const shown = document.sections.filter(section => !section.hidden);
    const index = shown.findIndex(section => section.type === PAGE_CONTENT);
    const others = (list: SectionData[]) => list.filter(section => section.type !== PAGE_CONTENT);
    if (index < 0) return { before: [], content: null, after: shown };
    return {
        before: others(shown.slice(0, index)),
        content: shown[index]!,
        after: others(shown.slice(index + 1)),
    };
}

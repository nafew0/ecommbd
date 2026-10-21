import { formatTaka } from '@ecommbd/shared/money';
import { asciiToBanglaDigits } from '@ecommbd/shared/text';

/** Storefront UI strings in Bangla and English (terms from docs/glossary.md). */

export type Lang = 'bn' | 'en';

export const LANGS: readonly Lang[] = ['bn', 'en'];

export function otherLang(lang: Lang): Lang {
    return lang === 'bn' ? 'en' : 'bn';
}

export function isLang(value: string | undefined): value is Lang {
    return value === 'bn' || value === 'en';
}

const en = {
    langName: 'English',
    switchTo: 'বাংলা',
    switchToLabel: 'বাংলায় দেখুন',
    home: 'Home',
    skipToContent: 'Skip to content',
    homeDescription: (store: string) => `Shop online at ${store}. Cash on delivery across Bangladesh.`,
    breadcrumb: 'Breadcrumb',
    menu: 'Menu',
    cart: 'Cart',
    search: 'Search',
    searchPlaceholder: 'Search products…',
    categories: 'Categories',
    productsHeading: 'Products',
    newArrivals: 'New arrivals',
    seeAll: 'See all',
    products: (n: number) => (n === 1 ? '1 product' : `${n} products`),
    noProducts: 'No products here yet.',
    subcategories: 'More in this category',
    previous: 'Previous',
    next: 'Next',
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    inStock: 'In stock',
    lowStock: 'Only a few left',
    outOfStock: 'Out of stock',
    options: 'Options',
    description: 'Description',
    orderOnWhatsapp: 'Order on WhatsApp',
    whatsappMessage: (name: string, url: string) => `Hello, I want to order: ${name}\n${url}`,
    noImage: 'No photo yet',
    resultsFor: (query: string) => `Results for “${query}”`,
    nothingFound: 'Nothing found. Try another word.',
    comingSoon: 'Coming soon.',
    cartTitle: 'Cart',
    checkoutTitle: 'Checkout',
    accountTitle: 'My account',
    trackTitle: 'Track order',
    trackIntro: 'Order tracking opens here soon. Until then, call or message us with your order number.',
    notFoundTitle: 'Page not found',
    notFoundText: 'This page doesn’t exist. It may have moved.',
    goHome: 'Go to the home page',
    goneTitle: 'This product is no longer available',
    goneText: 'It was removed from the shop. You may like these instead:',
    errorTitle: 'Something went wrong',
    unavailableText: 'The shop is temporarily unavailable. Please try again in a minute.',
    errorText: 'Please try again. If it keeps happening, call or message us.',
    contact: 'Contact',
    followUs: 'Follow us',
    weAccept: 'We accept',
    cashOnDelivery: 'Cash on delivery',
    tradeLicence: 'Trade licence',
    chatWhatsapp: 'Chat on WhatsApp',
    chatMessenger: 'Message us on Messenger',
    callUs: 'Call us',
};

export type Strings = typeof en;

const bn: Strings = {
    langName: 'বাংলা',
    switchTo: 'English',
    switchToLabel: 'View in English',
    home: 'হোম',
    skipToContent: 'মূল অংশে যান',
    homeDescription: (store: string) => `${store} থেকে অনলাইনে কেনাকাটা করুন। সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।`,
    breadcrumb: 'আপনি এখানে',
    menu: 'মেনু',
    cart: 'কার্ট',
    search: 'খুঁজুন',
    searchPlaceholder: 'পণ্য খুঁজুন…',
    categories: 'ক্যাটাগরি',
    productsHeading: 'পণ্য',
    newArrivals: 'নতুন পণ্য',
    seeAll: 'সব দেখুন',
    products: (n: number) => `${asciiToBanglaDigits(String(n))}টি পণ্য`,
    noProducts: 'এখানে এখনো কোনো পণ্য নেই।',
    subcategories: 'এই ক্যাটাগরিতে আরও',
    previous: 'আগের পাতা',
    next: 'পরের পাতা',
    pageOf: (page: number, pages: number) =>
        `পাতা ${asciiToBanglaDigits(String(page))} / ${asciiToBanglaDigits(String(pages))}`,
    inStock: 'স্টকে আছে',
    lowStock: 'অল্প কয়েকটি বাকি',
    outOfStock: 'স্টকে নেই',
    options: 'অপশন',
    description: 'বিবরণ',
    orderOnWhatsapp: 'হোয়াটসঅ্যাপে অর্ডার করুন',
    whatsappMessage: (name: string, url: string) => `আসসালামু আলাইকুম, আমি অর্ডার করতে চাই: ${name}\n${url}`,
    noImage: 'এখনো ছবি নেই',
    resultsFor: (query: string) => `“${query}” এর ফলাফল`,
    nothingFound: 'কিছু পাওয়া যায়নি। অন্য শব্দ দিয়ে খুঁজুন।',
    comingSoon: 'শিগগিরই আসছে।',
    cartTitle: 'কার্ট',
    checkoutTitle: 'চেকআউট',
    accountTitle: 'আমার অ্যাকাউন্ট',
    trackTitle: 'অর্ডার ট্র্যাক করুন',
    trackIntro: 'অর্ডার ট্র্যাকিং শিগগিরই এখানে চালু হবে। ততদিন অর্ডার নম্বর দিয়ে আমাদের কল বা মেসেজ করুন।',
    notFoundTitle: 'পাতাটি পাওয়া যায়নি',
    notFoundText: 'এই পাতাটি নেই। হয়তো অন্য জায়গায় সরানো হয়েছে।',
    goHome: 'হোম পেজে যান',
    goneTitle: 'এই পণ্যটি আর পাওয়া যাচ্ছে না',
    goneText: 'পণ্যটি দোকান থেকে সরানো হয়েছে। এগুলো দেখতে পারেন:',
    errorTitle: 'কিছু একটা সমস্যা হয়েছে',
    unavailableText: 'দোকানটি কিছুক্ষণের জন্য বন্ধ আছে। এক মিনিট পরে আবার চেষ্টা করুন।',
    errorText: 'আবার চেষ্টা করুন। বারবার হলে আমাদের কল বা মেসেজ করুন।',
    contact: 'যোগাযোগ',
    followUs: 'আমাদের ফলো করুন',
    weAccept: 'পেমেন্ট',
    cashOnDelivery: 'ক্যাশ অন ডেলিভারি',
    tradeLicence: 'ট্রেড লাইসেন্স',
    chatWhatsapp: 'হোয়াটসঅ্যাপে কথা বলুন',
    chatMessenger: 'মেসেঞ্জারে মেসেজ দিন',
    callUs: 'কল করুন',
};

export const STRINGS: Record<Lang, Strings> = { bn, en };

export function t(lang: Lang): Strings {
    return STRINGS[lang];
}

export interface Formatter {
    /** `৳1,250` (or `৳১,২৫০` in Bangla when the store shows Bangla digits). */
    price(minor: number): string;
    /** `৳500 – ৳900`, or one price when they're equal. */
    priceRange(min: number, max: number): string;
    number(value: number): string;
}

/** Bangla digits only on Bangla pages, and only when the store setting is on. */
export function formatter(lang: Lang, banglaDigitsSetting: boolean): Formatter {
    const banglaDigits = lang === 'bn' && banglaDigitsSetting;
    const price = (minor: number) => formatTaka(minor, { banglaDigits });
    return {
        price,
        priceRange: (min, max) => (min === max ? price(min) : `${price(min)} – ${price(max)}`),
        number: value => (banglaDigits ? asciiToBanglaDigits(String(value)) : String(value)),
    };
}

import type { CheckoutErrorCode } from './errors';

/**
 * Checkout messages in English and Bangla, keyed by error code (`errorResult.BD_CHECKOUT.<code>`)
 * and, for the payment guard, by message key (`message.bd-checkout.<key>`). Terms follow
 * docs/glossary.md.
 */
const en: Record<CheckoutErrorCode, string> = {
    INVALID_PHONE: 'Enter a valid mobile number, e.g. 01712-345678.',
    NOT_A_MOBILE: 'This looks like a landline number. Enter a mobile number.',
    NAME_REQUIRED: 'Enter your name.',
    NAME_TOO_LONG: 'The name can be at most 100 characters.',
    INVALID_ALTERNATE_PHONE: 'The alternate phone number is not valid.',
    INVALID_EMAIL: 'Enter a valid email address, or leave it empty.',
    UNKNOWN_DISTRICT: 'Choose your district from the list.',
    THANA_NOT_IN_DISTRICT: 'This thana is not in the selected district. Choose the thana again.',
    AREA_REQUIRED: 'Write your area name, because the thana is not listed.',
    ADDRESS_TOO_SHORT: 'Write your full address: house, road and area.',
    ADDRESS_TOO_LONG: 'The address is too long.',
    FIELD_TOO_LONG: 'This is too long.',
    NOTE_TOO_LONG: 'The note can be at most 500 characters.',
    RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
    NO_ACTIVE_ORDER: 'Your cart is empty or has expired. Please add the product again.',
    ALREADY_LOGGED_IN: 'You are signed in, so your account details are used for this order.',
};

const bn: Record<CheckoutErrorCode, string> = {
    INVALID_PHONE: 'সঠিক মোবাইল নম্বর দিন, যেমন ০১৭১২-৩৪৫৬৭৮।',
    NOT_A_MOBILE: 'এটি ল্যান্ডফোন নম্বর মনে হচ্ছে। মোবাইল নম্বর দিন।',
    NAME_REQUIRED: 'আপনার নাম লিখুন।',
    NAME_TOO_LONG: 'নাম সর্বোচ্চ ১০০ অক্ষরের হতে পারে।',
    INVALID_ALTERNATE_PHONE: 'বিকল্প ফোন নম্বরটি সঠিক নয়।',
    INVALID_EMAIL: 'সঠিক ইমেইল দিন, অথবা ঘরটি খালি রাখুন।',
    UNKNOWN_DISTRICT: 'তালিকা থেকে আপনার জেলা বেছে নিন।',
    THANA_NOT_IN_DISTRICT: 'এই থানাটি নির্বাচিত জেলার মধ্যে নয়। আবার থানা বেছে নিন।',
    AREA_REQUIRED: 'থানা তালিকায় না থাকায় এলাকার নাম লিখুন।',
    ADDRESS_TOO_SHORT: 'পুরো ঠিকানা লিখুন: বাসা, রোড ও এলাকা।',
    ADDRESS_TOO_LONG: 'ঠিকানাটি অনেক বড়।',
    FIELD_TOO_LONG: 'লেখাটি অনেক বড়।',
    NOTE_TOO_LONG: 'নোট সর্বোচ্চ ৫০০ অক্ষরের হতে পারে।',
    RATE_LIMITED: 'অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
    NO_ACTIVE_ORDER: 'আপনার কার্ট খালি বা মেয়াদ শেষ। পণ্যটি আবার যোগ করুন।',
    ALREADY_LOGGED_IN: 'আপনি সাইন ইন করা আছেন, তাই এই অর্ডারে আপনার অ্যাকাউন্টের তথ্য ব্যবহার হবে।',
};

export const checkoutTranslations = {
    en: {
        errorResult: { BD_CHECKOUT: en },
        message: {
            'bd-checkout': {
                'phone-required': 'Add the customer’s mobile number before payment.',
                'address-required': 'Add a delivery address with district and thana before payment.',
            },
        },
    },
    bn: {
        errorResult: { BD_CHECKOUT: bn },
        message: {
            'bd-checkout': {
                'phone-required': 'পেমেন্টের আগে কাস্টমারের মোবাইল নম্বর দিন।',
                'address-required': 'পেমেন্টের আগে জেলা ও থানাসহ ডেলিভারির ঠিকানা দিন।',
            },
        },
    },
};

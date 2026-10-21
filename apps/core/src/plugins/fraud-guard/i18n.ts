import type { OtpErrorCode } from './otp.service';

/**
 * Shopper messages in English and Bangla (`message.fraud-guard.*`). A blocked shopper is never told
 * so. Terms follow docs/glossary.md.
 */
const otpEn: Record<OtpErrorCode, string> = {
    NO_ACTIVE_ORDER: 'Your cart is empty or has expired. Please add the product again.',
    NOT_NEEDED: 'No code is needed for this order.',
    COOLDOWN: 'We just sent a code. Please wait a moment before asking for another.',
    DAILY_LIMIT: 'Too many codes today. Please pay by mobile banking, or call us.',
    NO_CODE: 'Ask for a code first.',
    EXPIRED: 'This code has expired. Ask for a new one.',
    WRONG_CODE: 'The code is not right. Check the SMS and try again.',
    TOO_MANY_ATTEMPTS: 'Too many wrong tries. Ask for a new code.',
    NOT_ALLOWED: 'Please enter the code to place the order.',
};

const otpBn: Record<OtpErrorCode, string> = {
    NO_ACTIVE_ORDER: 'আপনার কার্ট খালি বা মেয়াদ শেষ। পণ্যটি আবার যোগ করুন।',
    NOT_NEEDED: 'এই অর্ডারে কোড লাগবে না।',
    COOLDOWN: 'এইমাত্র কোড পাঠানো হয়েছে। নতুন কোড চাওয়ার আগে একটু অপেক্ষা করুন।',
    DAILY_LIMIT: 'আজ অনেকবার কোড চাওয়া হয়েছে। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন, বা আমাদের কল করুন।',
    NO_CODE: 'আগে কোড চান।',
    EXPIRED: 'কোডটির মেয়াদ শেষ। নতুন কোড চান।',
    WRONG_CODE: 'কোডটি সঠিক নয়। এসএমএস দেখে আবার চেষ্টা করুন।',
    TOO_MANY_ATTEMPTS: 'অনেকবার ভুল হয়েছে। নতুন কোড চান।',
    NOT_ALLOWED: 'অর্ডার করতে কোডটি দিন।',
};

export const fraudTranslations = {
    en: {
        message: {
            'fraud-guard': {
                unavailable: 'Sorry, we can’t take this order online. Please call or message us to order.',
                'too-many': 'You have placed several orders today. Please call or message us to order more.',
                otp: otpEn,
            },
        },
    },
    bn: {
        message: {
            'fraud-guard': {
                unavailable: 'দুঃখিত, এই অর্ডারটি অনলাইনে নেওয়া যাচ্ছে না। অর্ডার করতে আমাদের কল বা মেসেজ করুন।',
                'too-many': 'আজ আপনি কয়েকটি অর্ডার করেছেন। আরও অর্ডার করতে আমাদের কল বা মেসেজ করুন।',
                otp: otpBn,
            },
        },
    },
};

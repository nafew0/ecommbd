import type { ReviewError } from './online-payment.service';

/**
 * Online payment messages in English and Bangla: what checkout shows when a gateway can't be used
 * (`message.payments-online.<code>`) and staff action errors (`errorResult.BD_ONLINE_PAYMENT.<code>`).
 * Terms follow docs/glossary.md.
 */
const errorsEn: Record<ReviewError, string> = {
    NOT_FOUND: 'This payment doesn’t exist.',
    NOT_OPEN: 'Someone already decided on this payment.',
    NOT_RISKY: 'Only a payment held as risky can be accepted.',
    NOTE_REQUIRED: 'Write a short note on how it was handled.',
    REFUND_FAILED: 'The gateway refused the refund. Check its panel, or refund by hand and mark it resolved.',
    UNAVAILABLE: 'The gateway’s credentials for this mode aren’t saved.',
};

const errorsBn: Record<ReviewError, string> = {
    NOT_FOUND: 'এই পেমেন্টটি পাওয়া যায়নি।',
    NOT_OPEN: 'অন্য কেউ এই পেমেন্টের সিদ্ধান্ত আগেই নিয়েছেন।',
    NOT_RISKY: 'শুধু ঝুঁকিপূর্ণ হিসেবে আটকে রাখা পেমেন্ট গ্রহণ করা যায়।',
    NOTE_REQUIRED: 'কীভাবে সমাধান হলো, একটি ছোট নোট লিখুন।',
    REFUND_FAILED:
        'গেটওয়ে রিফান্ড নেয়নি। গেটওয়ের প্যানেল দেখুন, অথবা হাতে রিফান্ড করে সমাধান হয়েছে চিহ্নিত করুন।',
    UNAVAILABLE: 'এই মোডের জন্য গেটওয়ের তথ্য সেভ করা নেই।',
};

const messagesEn = {
    ONLINE_UNAVAILABLE: 'Online payment isn’t available right now. Please choose another way to pay.',
    TEMPORARILY_UNAVAILABLE:
        'Temporarily unavailable. Please try again in a few minutes, or choose cash on delivery.',
    NO_ADVANCE_NEEDED: 'This order doesn’t need an advance.',
    AMOUNT_OUT_OF_RANGE: 'Online payment works for ৳10 to ৳5,00,000. Please choose another way to pay.',
    'not-covered': 'The payments don’t cover the order total.',
};

const messagesBn: typeof messagesEn = {
    ONLINE_UNAVAILABLE: 'এখন অনলাইন পেমেন্ট করা যাচ্ছে না। অন্য কোনো উপায়ে পেমেন্ট বেছে নিন।',
    TEMPORARILY_UNAVAILABLE:
        'সাময়িকভাবে বন্ধ আছে। কয়েক মিনিট পর আবার চেষ্টা করুন, অথবা ক্যাশ অন ডেলিভারি বেছে নিন।',
    NO_ADVANCE_NEEDED: 'এই অর্ডারে অগ্রিম লাগবে না।',
    AMOUNT_OUT_OF_RANGE:
        'অনলাইন পেমেন্ট ৳১০ থেকে ৳৫,০০,০০০ পর্যন্ত করা যায়। অন্য কোনো উপায়ে পেমেন্ট বেছে নিন।',
    'not-covered': 'পেমেন্টগুলো অর্ডারের মোট টাকা পূরণ করে না।',
};

export const onlinePaymentTranslations = {
    en: { errorResult: { BD_ONLINE_PAYMENT: errorsEn }, message: { 'payments-online': messagesEn } },
    bn: { errorResult: { BD_ONLINE_PAYMENT: errorsBn }, message: { 'payments-online': messagesBn } },
};

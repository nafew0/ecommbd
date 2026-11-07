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
    REFUND_FAILED:
        'The gateway refused the refund, so nothing was refunded. Try again later, or refund by hand and mark it resolved.',
    REFUND_UNKNOWN:
        'The gateway didn’t answer, so the refund may have gone through. Don’t refund again: it stays as “Refund processing” while we check with the gateway. Check its panel too.',
    REFUND_NO_TRANSACTION:
        'This payment has no gateway transaction to refund. Refund by hand and mark it resolved.',
    REFUND_TOO_LATE: 'bKash refunds only within 60 days of the payment. Refund by hand and mark it resolved.',
    REFUND_TOO_MUCH: 'bKash can’t refund this much of the payment any more. The most it can still refund:',
    REFUND_TOO_SOON: 'A refund was asked for less than 10 minutes ago. Try again in a few minutes.',
    REFUND_LIMIT: 'bKash allows at most 10 refunds of a payment. Refund by hand and mark it resolved.',
    UNAVAILABLE: 'The gateway’s credentials for this mode aren’t saved.',
    NO_TRANSACTION: 'This try has no bKash transaction to look up.',
};

const errorsBn: Record<ReviewError, string> = {
    NOT_FOUND: 'এই পেমেন্টটি পাওয়া যায়নি।',
    NOT_OPEN: 'অন্য কেউ এই পেমেন্টের সিদ্ধান্ত আগেই নিয়েছেন।',
    NOT_RISKY: 'শুধু ঝুঁকিপূর্ণ হিসেবে আটকে রাখা পেমেন্ট গ্রহণ করা যায়।',
    NOTE_REQUIRED: 'কীভাবে সমাধান হলো, একটি ছোট নোট লিখুন।',
    REFUND_FAILED:
        'গেটওয়ে রিফান্ড নেয়নি, তাই কিছু রিফান্ড হয়নি। পরে আবার চেষ্টা করুন, অথবা হাতে রিফান্ড করে সমাধান হয়েছে চিহ্নিত করুন।',
    REFUND_UNKNOWN:
        'গেটওয়ে উত্তর দেয়নি, তাই রিফান্ড হয়ে যেতেও পারে। আবার রিফান্ড করবেন না: গেটওয়ের সাথে যাচাই হওয়া পর্যন্ত এটি “রিফান্ড প্রক্রিয়াধীন” থাকবে। গেটওয়ের প্যানেলও দেখুন।',
    REFUND_NO_TRANSACTION:
        'এই পেমেন্টে রিফান্ড করার মতো কোনো গেটওয়ে ট্রানজেকশন নেই। হাতে রিফান্ড করে সমাধান হয়েছে চিহ্নিত করুন।',
    REFUND_TOO_LATE:
        'বিকাশ পেমেন্টের ৬০ দিনের মধ্যেই শুধু রিফান্ড করে। হাতে রিফান্ড করে সমাধান হয়েছে চিহ্নিত করুন।',
    REFUND_TOO_MUCH: 'বিকাশ এই পেমেন্টের এত টাকা আর রিফান্ড করতে পারবে না। সর্বোচ্চ যত রিফান্ড করা যাবে:',
    REFUND_TOO_SOON: '১০ মিনিটের কম সময় আগে একটি রিফান্ড চাওয়া হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।',
    REFUND_LIMIT:
        'বিকাশ একটি পেমেন্টে সর্বোচ্চ ১০ বার রিফান্ড করে। হাতে রিফান্ড করে সমাধান হয়েছে চিহ্নিত করুন।',
    UNAVAILABLE: 'এই মোডের জন্য গেটওয়ের তথ্য সেভ করা নেই।',
    NO_TRANSACTION: 'এই চেষ্টায় খোঁজার মতো কোনো বিকাশ ট্রানজেকশন নেই।',
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

import type { PaymentErrorCode } from './payment-checks.service';

/**
 * Payment messages in English and Bangla: staff action errors (`errorResult.BD_PAYMENT.<code>`) and
 * what the storefront shows when a payment is refused (`message.payments-bd.<code>`). Terms follow
 * docs/glossary.md.
 */
const errorsEn: Record<PaymentErrorCode, string> = {
    PAYMENT_NOT_FOUND: 'This payment doesn’t exist, or can’t be changed.',
    ALREADY_CHECKED: 'Someone already checked this payment.',
    INVALID_AMOUNT: 'Enter the amount in whole taka.',
    INVALID_REASON: 'Choose why the payment is rejected.',
    NOTE_REQUIRED: 'Write a short note when the reason is “Other”.',
    NOTE_TOO_LONG: 'The note can be at most 500 characters.',
    INVALID_METHOD: 'Choose how the money was given back.',
    REFUND_TOO_LARGE: 'The refund is more than what’s left of this payment.',
    REFUND_FAILED: 'The refund couldn’t be recorded. Try again.',
};

const errorsBn: Record<PaymentErrorCode, string> = {
    PAYMENT_NOT_FOUND: 'এই পেমেন্টটি পাওয়া যায়নি, বা বদলানো যায় না।',
    ALREADY_CHECKED: 'অন্য কেউ এই পেমেন্টটি আগেই যাচাই করেছেন।',
    INVALID_AMOUNT: 'পূর্ণ টাকায় পরিমাণ লিখুন।',
    INVALID_REASON: 'পেমেন্ট বাতিলের কারণ বেছে নিন।',
    NOTE_REQUIRED: 'কারণ “অন্যান্য” হলে একটি ছোট নোট লিখুন।',
    NOTE_TOO_LONG: 'নোট সর্বোচ্চ ৫০০ অক্ষরের হতে পারে।',
    INVALID_METHOD: 'টাকা কীভাবে ফেরত দেওয়া হয়েছে বেছে নিন।',
    REFUND_TOO_LARGE: 'রিফান্ডের পরিমাণ এই পেমেন্টের বাকি টাকার চেয়ে বেশি।',
    REFUND_FAILED: 'রিফান্ডের তথ্য রাখা যায়নি। আবার চেষ্টা করুন।',
};

/** Shown to shoppers. COD_UNAVAILABLE covers blocked phones too, without saying so. */
const shopperEn = {
    COD_OFF: 'Cash on delivery isn’t available. Please pay by mobile banking.',
    COD_OVER_LIMIT: 'Cash on delivery isn’t available for an order this large. Please pay by mobile banking.',
    COD_NOT_HERE: 'Cash on delivery isn’t available in this area. Please pay by mobile banking.',
    COD_UNAVAILABLE:
        'Cash on delivery isn’t available for this order. Please pay by mobile banking, or contact us.',
    COD_FEE_CHANGED: 'Your order changed. Please choose how to pay again.',
    ADVANCE_REQUIRED: 'Please pay the advance by mobile banking first.',
    NO_ADVANCE_NEEDED: 'No advance is needed for this order.',
    MFS_OFF: 'This payment method isn’t available.',
    INVALID_SENDER: 'Enter the mobile number you sent the money from.',
    INVALID_TRANSACTION_ID:
        'Enter the transaction ID from the confirmation SMS (8 to 12 letters and numbers).',
    DUPLICATE_TRANSACTION_ID: 'This transaction ID was already used. Check the ID in your SMS.',
    RATE_LIMITED: 'Too many tries. Please wait a few minutes and try again.',
};

const shopperBn: typeof shopperEn = {
    COD_OFF: 'ক্যাশ অন ডেলিভারি চালু নেই। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন।',
    COD_OVER_LIMIT: 'এত বড় অর্ডারে ক্যাশ অন ডেলিভারি নেই। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন।',
    COD_NOT_HERE: 'এই এলাকায় ক্যাশ অন ডেলিভারি নেই। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন।',
    COD_UNAVAILABLE:
        'এই অর্ডারে ক্যাশ অন ডেলিভারি নেই। মোবাইল ব্যাংকিংয়ে পেমেন্ট করুন, বা আমাদের সাথে যোগাযোগ করুন।',
    COD_FEE_CHANGED: 'আপনার অর্ডার বদলেছে। আবার পেমেন্টের ধরন বেছে নিন।',
    ADVANCE_REQUIRED: 'আগে মোবাইল ব্যাংকিংয়ে অগ্রিম টাকা পাঠান।',
    NO_ADVANCE_NEEDED: 'এই অর্ডারে অগ্রিম লাগবে না।',
    MFS_OFF: 'এই পেমেন্ট পদ্ধতি চালু নেই।',
    INVALID_SENDER: 'যে মোবাইল নম্বর থেকে টাকা পাঠিয়েছেন সেটি লিখুন।',
    INVALID_TRANSACTION_ID: 'কনফার্মেশন SMS-এর ট্রানজেকশন আইডি লিখুন (৮ থেকে ১২টি অক্ষর ও সংখ্যা)।',
    DUPLICATE_TRANSACTION_ID: 'এই ট্রানজেকশন আইডি আগেই ব্যবহার হয়েছে। SMS-এ আইডিটি আবার দেখুন।',
    RATE_LIMITED: 'অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
};

export type ShopperPaymentMessage = keyof typeof shopperEn;

export const paymentTranslations = {
    en: { errorResult: { BD_PAYMENT: errorsEn }, message: { 'payments-bd': shopperEn } },
    bn: { errorResult: { BD_PAYMENT: errorsBn }, message: { 'payments-bd': shopperBn } },
};

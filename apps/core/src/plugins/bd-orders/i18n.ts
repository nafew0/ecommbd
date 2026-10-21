import type { OrderActionErrorCode } from './errors';

/**
 * Order workflow messages in English and Bangla: action errors (`errorResult.BD_ORDER.<code>`)
 * and order-process refusals (`message.bd-orders.<key>`). Terms follow docs/glossary.md.
 */
const en: Record<OrderActionErrorCode, string> = {
    ORDER_NOT_FOUND: 'This order doesn’t exist.',
    ALREADY_CHANGED: 'Someone else already changed this order. Here is its current status.',
    NOT_ALLOWED: 'This can’t be done with the order in its current status.',
    INVALID_REASON: 'Choose why the order is cancelled.',
    NOTE_REQUIRED: 'Write a short note when the reason is “Other”.',
    NOTE_TOO_LONG: 'The note can be at most 500 characters.',
    INSUFFICIENT_STOCK:
        'Not enough stock for some items. Edit the order, cancel it, or confirm anyway if new stock is coming.',
    REFUND_REQUIRED:
        'Money was received for this order. Record the refund on the order page before cancelling.',
    NOT_IN_QUEUE: 'Calls can be recorded only for new orders.',
    INVALID_TIME: 'Choose a time later than now, within the next 30 days.',
    INVALID_OUTCOME: 'Unknown call result.',
};

const bn: Record<OrderActionErrorCode, string> = {
    ORDER_NOT_FOUND: 'এই অর্ডারটি পাওয়া যায়নি।',
    ALREADY_CHANGED: 'অন্য কেউ এই অর্ডারটি আগেই বদলেছেন। এখনকার অবস্থা দেখুন।',
    NOT_ALLOWED: 'অর্ডারের এখনকার অবস্থায় এটি করা যায় না।',
    INVALID_REASON: 'অর্ডার বাতিলের কারণ বেছে নিন।',
    NOTE_REQUIRED: 'কারণ “অন্যান্য” হলে একটি ছোট নোট লিখুন।',
    NOTE_TOO_LONG: 'নোট সর্বোচ্চ ৫০০ অক্ষরের হতে পারে।',
    INSUFFICIENT_STOCK:
        'কিছু পণ্যের স্টক নেই। অর্ডারটি এডিট করুন, বাতিল করুন, অথবা নতুন স্টক আসার কথা থাকলে তবুও কনফার্ম করুন।',
    REFUND_REQUIRED: 'এই অর্ডারের টাকা পাওয়া গেছে। বাতিলের আগে অর্ডারের পাতায় রিফান্ডের তথ্য লিখুন।',
    NOT_IN_QUEUE: 'শুধু নতুন অর্ডারের কলের তথ্য রাখা যায়।',
    INVALID_TIME: 'এখনকার পরের এবং আগামী ৩০ দিনের মধ্যে একটি সময় বেছে নিন।',
    INVALID_OUTCOME: 'কলের ফল বোঝা যায়নি।',
};

export const orderTranslations = {
    en: {
        error: {
            'bd-orders': {
                'invalid-date': 'Dates must look like 2026-10-21.',
                'cancel-reason-required': 'Choose a cancel reason before cancelling a placed order.',
            },
        },
        errorResult: { BD_ORDER: en },
        message: {
            'bd-orders': {
                'not-allowed': 'This order can’t move to that status from its current status.',
                'cancel-reason-required': 'Choose a cancel reason before cancelling a placed order.',
                'confirm-first': 'Confirm the order before packing it.',
            },
        },
    },
    bn: {
        error: {
            'bd-orders': {
                'invalid-date': 'তারিখ এভাবে লিখুন: 2026-10-21।',
                'cancel-reason-required': 'অর্ডার বাতিলের আগে কারণ বেছে নিন।',
            },
        },
        errorResult: { BD_ORDER: bn },
        message: {
            'bd-orders': {
                'not-allowed': 'অর্ডারটি এখনকার অবস্থা থেকে ওই অবস্থায় নেওয়া যায় না।',
                'cancel-reason-required': 'অর্ডার বাতিলের আগে কারণ বেছে নিন।',
                'confirm-first': 'প্যাক করার আগে অর্ডারটি কনফার্ম করুন।',
            },
        },
    },
};

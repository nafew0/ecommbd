import type { ManualOrderErrorCode } from '@ecommbd/shared';

/** Manual order and edit errors (`errorResult.BD_MANUAL_ORDER.<code>`). Terms follow docs/glossary.md. */
const en: Record<ManualOrderErrorCode, string> = {
    INVALID_PHONE: 'Enter the customer’s mobile number (e.g. 01712-345678).',
    NAME_REQUIRED: 'Enter the customer’s name (up to 100 characters).',
    NO_ITEMS: 'Add at least one product.',
    INVALID_QUANTITY: 'Quantities must be whole numbers from 1 to 1,000.',
    UNKNOWN_PRODUCT: 'One of the products no longer exists.',
    INSUFFICIENT_STOCK: 'Not enough stock for some products.',
    INVALID_PRICE: 'Prices must be whole taka.',
    PRICE_OVERRIDE_NOT_ALLOWED: 'You can’t change prices or the delivery charge. Ask the owner or a manager.',
    DISCOUNT_NOT_ALLOWED: 'You can’t give discounts. Ask the owner or a manager.',
    DISCOUNT_TOO_LARGE: 'This discount is more than you can give on this order.',
    INVALID_ADDRESS: 'Check the address: choose the district and thana, and write the house and road.',
    NO_DELIVERY: 'There’s no delivery to this address. Check the area, or set the delivery charge.',
    INVALID_SOURCE: 'Choose where the order came from.',
    INVALID_PAYMENT: 'Check the payment: how it was paid, and the amount.',
    INVALID_TRANSACTION_ID: 'Enter the transaction ID (8 to 12 letters and numbers).',
    DUPLICATE_TRANSACTION_ID: 'This transaction ID was already used on another order.',
    PAYMENT_REFUSED: 'This payment can’t be used for the order.',
    ORDER_NOT_FOUND: 'This order doesn’t exist.',
    NOT_EDITABLE: 'This order can’t be edited any more (it’s on its way or finished).',
    ALREADY_CHANGED: 'Someone else changed this order. Open it again to see the changes.',
    COURIER_BOOKED: 'Cancel the courier booking first, then edit the order.',
    NOTHING_CHANGED: 'Nothing was changed.',
};

const bn: Record<ManualOrderErrorCode, string> = {
    INVALID_PHONE: 'কাস্টমারের মোবাইল নম্বর দিন (যেমন 01712-345678)।',
    NAME_REQUIRED: 'কাস্টমারের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।',
    NO_ITEMS: 'অন্তত একটি পণ্য যোগ করুন।',
    INVALID_QUANTITY: 'পরিমাণ ১ থেকে ১,০০০ এর মধ্যে পূর্ণ সংখ্যা হতে হবে।',
    UNKNOWN_PRODUCT: 'একটি পণ্য আর নেই।',
    INSUFFICIENT_STOCK: 'কিছু পণ্যের যথেষ্ট স্টক নেই।',
    INVALID_PRICE: 'দাম পূর্ণ টাকায় হতে হবে।',
    PRICE_OVERRIDE_NOT_ALLOWED: 'আপনি দাম বা ডেলিভারি চার্জ বদলাতে পারবেন না। মালিক বা ম্যানেজারকে বলুন।',
    DISCOUNT_NOT_ALLOWED: 'আপনি ছাড় দিতে পারবেন না। মালিক বা ম্যানেজারকে বলুন।',
    DISCOUNT_TOO_LARGE: 'এই অর্ডারে আপনি এত ছাড় দিতে পারবেন না।',
    INVALID_ADDRESS: 'ঠিকানা দেখুন: জেলা ও থানা বেছে নিন, আর বাসা ও রাস্তা লিখুন।',
    NO_DELIVERY: 'এই ঠিকানায় ডেলিভারি নেই। এলাকা দেখুন, বা ডেলিভারি চার্জ লিখে দিন।',
    INVALID_SOURCE: 'অর্ডার কোথা থেকে এসেছে বেছে নিন।',
    INVALID_PAYMENT: 'পেমেন্ট দেখুন: কীভাবে দিয়েছেন, আর কত টাকা।',
    INVALID_TRANSACTION_ID: 'ট্রানজেকশন আইডি লিখুন (৮ থেকে ১২টি অক্ষর ও সংখ্যা)।',
    DUPLICATE_TRANSACTION_ID: 'এই ট্রানজেকশন আইডি অন্য অর্ডারে আগেই ব্যবহার হয়েছে।',
    PAYMENT_REFUSED: 'এই পেমেন্ট দিয়ে অর্ডারটি করা যাচ্ছে না।',
    ORDER_NOT_FOUND: 'এই অর্ডারটি পাওয়া যায়নি।',
    NOT_EDITABLE: 'এই অর্ডার আর এডিট করা যাবে না (ডেলিভারিতে গেছে বা শেষ)।',
    ALREADY_CHANGED: 'অন্য কেউ অর্ডারটি বদলেছেন। পরিবর্তন দেখতে আবার খুলুন।',
    COURIER_BOOKED: 'আগে কুরিয়ার বুকিং বাতিল করুন, তারপর অর্ডার এডিট করুন।',
    NOTHING_CHANGED: 'কিছু বদলানো হয়নি।',
};

export const manualOrderTranslations = {
    en: { errorResult: { BD_MANUAL_ORDER: en } },
    bn: { errorResult: { BD_MANUAL_ORDER: bn } },
};

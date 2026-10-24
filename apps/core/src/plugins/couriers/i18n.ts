import type { CourierErrorCode } from './courier.service';

/** Courier messages in English and Bangla (`errorResult.BD_COURIER.<code>`, `message.couriers.<key>`). */
const errorsEn: Record<CourierErrorCode, string> = {
    ORDER_NOT_FOUND: 'This order doesn’t exist.',
    NOT_READY: 'Only confirmed or packed orders can be booked.',
    NO_COURIER: 'Choose a courier (or set a default courier for this delivery zone).',
    COURIER_OFF: 'This courier is off, or its credentials aren’t saved.',
    UNMAPPED_ADDRESS: 'Pathao doesn’t know this thana yet. Match it in Couriers → Unmapped addresses.',
    NO_PHONE: 'The order has no phone number.',
    NO_PATHAO_STORE: 'Choose your Pathao store in Settings → Couriers.',
    COURIER_REFUSED: 'The courier refused the parcel. Fix the order and try again.',
    COURIER_UNAVAILABLE: 'The courier isn’t answering. Try again later, or mark it booked by hand.',
    ALREADY_BOOKED: 'This order is already booked.',
    NOT_BOOKED: 'This order has no courier booking.',
    ALREADY_PICKED_UP: 'The courier has picked it up: it can’t be cancelled now, only returned.',
    INVALID_INPUT: 'Check what you entered.',
};

const errorsBn: Record<CourierErrorCode, string> = {
    ORDER_NOT_FOUND: 'এই অর্ডারটি পাওয়া যায়নি।',
    NOT_READY: 'শুধু কনফার্মড বা প্যাকড অর্ডার বুক করা যায়।',
    NO_COURIER: 'কুরিয়ার বেছে নিন (বা এই ডেলিভারি এলাকার জন্য একটি কুরিয়ার ঠিক করে রাখুন)।',
    COURIER_OFF: 'এই কুরিয়ার বন্ধ, অথবা এর তথ্য সেভ করা নেই।',
    UNMAPPED_ADDRESS: 'পাঠাও এই থানা এখনো চেনে না। কুরিয়ার → না-মেলা ঠিকানা থেকে মিলিয়ে দিন।',
    NO_PHONE: 'অর্ডারে ফোন নম্বর নেই।',
    NO_PATHAO_STORE: 'সেটিংস → কুরিয়ার থেকে আপনার পাঠাও স্টোর বেছে নিন।',
    COURIER_REFUSED: 'কুরিয়ার পার্সেলটি নেয়নি। অর্ডার ঠিক করে আবার চেষ্টা করুন।',
    COURIER_UNAVAILABLE: 'কুরিয়ার সাড়া দিচ্ছে না। পরে চেষ্টা করুন, অথবা হাতে বুক করা হয়েছে লিখে রাখুন।',
    ALREADY_BOOKED: 'এই অর্ডার আগেই বুক করা হয়েছে।',
    NOT_BOOKED: 'এই অর্ডারের কোনো কুরিয়ার বুকিং নেই।',
    ALREADY_PICKED_UP: 'কুরিয়ার পার্সেল তুলে নিয়েছে: এখন বাতিল করা যাবে না, শুধু ফেরত আসবে।',
    INVALID_INPUT: 'যা লিখেছেন তা দেখে নিন।',
};

const messagesEn = {
    'cancel-booking-first': 'Cancel the courier booking first.',
};

const messagesBn: typeof messagesEn = {
    'cancel-booking-first': 'আগে কুরিয়ার বুকিং বাতিল করুন।',
};

export const courierTranslations = {
    en: { errorResult: { BD_COURIER: errorsEn }, message: { couriers: messagesEn } },
    bn: { errorResult: { BD_COURIER: errorsBn }, message: { couriers: messagesBn } },
};

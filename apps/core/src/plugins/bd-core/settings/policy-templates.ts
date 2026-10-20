import type { PolicyKey } from '@ecommbd/shared';

/**
 * Starting text for the store's policies, in Bangla and English. They're templates: the admin marks
 * them "review before publishing" until the merchant edits or accepts them. They are not legal
 * advice; merchants adapt them to their own business.
 */
export const POLICY_TEMPLATES: Record<PolicyKey, { bn: string; en: string }> = {
    returnPolicy: {
        bn: [
            'পণ্য হাতে পাওয়ার সময় ডেলিভারি ম্যানের সামনেই দেখে নিন। ভুল পণ্য, ভাঙা বা ত্রুটিপূর্ণ পণ্য, অথবা সাইজ বা রং না মিললে ডেলিভারির ৭২ ঘণ্টার মধ্যে আমাদের ফোন বা হোয়াটসঅ্যাপে জানান।',
            'ফেরত দেওয়ার শর্ত:\n- পণ্যটি অব্যবহৃত এবং আসল প্যাকেট ও ট্যাগসহ থাকতে হবে।\n- অর্ডার নম্বর এবং সমস্যার ছবি বা ভিডিও পাঠাতে হবে।\n- খাবার, প্রসাধনী, অন্তর্বাস এবং অর্ডার অনুযায়ী তৈরি পণ্য ফেরত নেওয়া হয় না, যদি না পণ্যটি ভুল বা ত্রুটিপূর্ণ হয়।',
            'আমাদের ভুলে (ভুল বা ত্রুটিপূর্ণ পণ্য) ফেরত হলে ডেলিভারি চার্জ আমরা দেব। অন্য কারণে ফেরত দিলে ডেলিভারি চার্জ কাস্টমারকে দিতে হবে।',
        ].join('\n\n'),
        en: [
            'Please check your order in front of the delivery person. If you received the wrong item, a damaged or faulty item, or the wrong size or colour, tell us by phone or WhatsApp within 72 hours of delivery.',
            'To return an item:\n- It must be unused, in its original packaging, with tags.\n- Send us your order number and a photo or video of the problem.\n- Food, cosmetics, innerwear and made-to-order items cannot be returned unless they are wrong or faulty.',
            'If the return is our mistake (wrong or faulty item), we pay the delivery charge. For other returns, the customer pays the delivery charge.',
        ].join('\n\n'),
    },
    refundPolicy: {
        bn: [
            'ফেরত দেওয়া পণ্য আমাদের কাছে পৌঁছানোর পর যাচাই করে ৭ কার্যদিবসের মধ্যে টাকা ফেরত দেওয়া হয়।',
            '- অগ্রিম বা অনলাইনে পেমেন্ট করলে, যে মাধ্যমে পেমেন্ট করেছেন (বিকাশ, নগদ, কার্ড) সেই মাধ্যমেই টাকা ফেরত দেওয়া হয়।\n- ক্যাশ অন ডেলিভারি অর্ডারে বিকাশ বা নগদে টাকা ফেরত দেওয়া হয়।\n- চাইলে টাকার বদলে একই দামের অন্য পণ্য নিতে পারেন।',
            'ভুল বা ত্রুটিপূর্ণ পণ্য ছাড়া অন্য কারণে ফেরত হলে ডেলিভারি চার্জ ফেরত দেওয়া হয় না।',
        ].join('\n\n'),
        en: [
            'Once a returned item reaches us and is checked, we refund within 7 working days.',
            '- Advance or online payments are refunded to the same method (bKash, Nagad, card).\n- Cash on delivery orders are refunded by bKash or Nagad.\n- If you prefer, you can take another product of the same price instead.',
            'Delivery charges are not refunded, unless the item was wrong or faulty.',
        ].join('\n\n'),
    },
    privacyPolicy: {
        bn: [
            'অর্ডার পৌঁছে দিতে আমরা আপনার নাম, ফোন নম্বর ও ঠিকানা নিই।',
            '- এই তথ্য শুধু অর্ডার প্রসেস, ডেলিভারি এবং অর্ডার সম্পর্কে আপনাকে জানাতে (এসএমএস বা ফোন) ব্যবহার করা হয়।\n- ডেলিভারির জন্য কুরিয়ার এবং পেমেন্টের জন্য পেমেন্ট প্রতিষ্ঠান শুধু প্রয়োজনীয় তথ্য পায়। আমরা আপনার তথ্য বিক্রি করি না।\n- বিজ্ঞাপনের ফলাফল মাপতে আমরা কুকি ও ট্র্যাকিং (যেমন মেটা পিক্সেল) ব্যবহার করতে পারি।',
            'আপনার তথ্য দেখতে, সংশোধন করতে বা মুছে ফেলতে আমাদের সাথে যোগাযোগ করুন। আইন অনুযায়ী যে হিসাবের তথ্য রাখতে হয় তা রেখে বাকি তথ্য মুছে ফেলা হবে।',
        ].join('\n\n'),
        en: [
            'To deliver your order, we collect your name, phone number and address.',
            '- We use them only to process and deliver your order and to tell you about it (SMS or phone).\n- Couriers and payment providers receive only what they need to deliver and take payment. We do not sell your data.\n- We may use cookies and tracking (such as the Meta Pixel) to measure our advertising.',
            'To see, correct or delete your data, contact us. We keep only the accounting records the law requires.',
        ].join('\n\n'),
    },
    terms: {
        bn: [
            'এই ওয়েবসাইট থেকে অর্ডার করলে আপনি নিচের শর্তগুলোতে সম্মত হচ্ছেন।',
            '- অর্ডারের পর আমাদের প্রতিনিধি ফোন করে অর্ডার কনফার্ম করতে পারেন। কনফার্ম না হওয়া অর্ডার বাতিল হতে পারে।\n- পণ্যের দাম ও স্টক যেকোনো সময় বদলাতে পারে। অর্ডারের সময়ের দামই প্রযোজ্য।\n- ঢাকার ভেতরে সাধারণত ১–৩ দিন এবং ঢাকার বাইরে ৩–৫ দিনে ডেলিভারি দেওয়া হয়।\n- ক্যাশ অন ডেলিভারিতে পণ্য দেখে ডেলিভারি ম্যানকে টাকা দিন। বারবার বাতিল করা অর্ডারের ক্ষেত্রে অগ্রিম পেমেন্ট চাওয়া হতে পারে।',
            'পণ্য ফেরত ও টাকা ফেরতের নিয়ম আমাদের রিটার্ন ও রিফান্ড নীতিতে দেওয়া আছে। যেকোনো প্রশ্নে আমাদের ফোন বা হোয়াটসঅ্যাপে যোগাযোগ করুন।',
        ].join('\n\n'),
        en: [
            'By ordering from this website, you agree to these terms.',
            '- After you order, we may call you to confirm it. Orders we cannot confirm may be cancelled.\n- Prices and stock can change at any time. The price at the time of your order applies.\n- Delivery usually takes 1–3 days inside Dhaka and 3–5 days outside Dhaka.\n- For cash on delivery, check the product and pay the delivery person. We may ask for an advance payment after repeated cancellations.',
            'Returns and refunds follow our return and refund policies. For any question, contact us by phone or WhatsApp.',
        ].join('\n\n'),
    },
};

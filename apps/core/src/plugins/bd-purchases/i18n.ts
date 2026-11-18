/** Purchase messages (`message.bd-purchases.<key>`). Terms follow docs/glossary.md. */
const en = {
    'not-found': 'That record could not be found.',
    'not-draft': 'This purchase can no longer be edited. Receive it, or return what arrived.',
    'not-ordered': 'Mark the purchase as ordered before receiving stock.',
    'over-receive': 'More arrived than was ordered. Write a short note, then receive it.',
    'nothing': 'Enter how many arrived, or how many you are sending back.',
    'return-too-many': 'You can only return what has arrived and not already gone back.',
    'delete-received': 'Stock from this purchase is already in. Return it instead of deleting it.',
    'variant-missing': 'One of the products on this purchase no longer exists.',
    'supplier-name': 'Give the supplier a name.',
    'supplier-phone': 'That phone number is not a Bangladeshi number.',
};

const bn: typeof en = {
    'not-found': 'এটি খুঁজে পাওয়া যায়নি।',
    'not-draft': 'এই ক্রয় আর বদলানো যায় না। মাল নিন, অথবা যা এসেছে তা ফেরত দিন।',
    'not-ordered': 'মাল নেওয়ার আগে ক্রয়টিকে অর্ডার করা হয়েছে বলে চিহ্নিত করুন।',
    'over-receive': 'অর্ডারের চেয়ে বেশি মাল এসেছে। এক লাইন নোট লিখে তারপর নিন।',
    'nothing': 'কত পিস এসেছে, বা কত পিস ফেরত যাচ্ছে, লিখুন।',
    'return-too-many': 'যে মাল এসেছে এবং আগে ফেরত যায়নি, শুধু সেটাই ফেরত দিতে পারবেন।',
    'delete-received': 'এই ক্রয়ের মাল ইতিমধ্যে স্টকে আছে। মুছে ফেলার বদলে ফেরত দিন।',
    'variant-missing': 'এই ক্রয়ের একটি পণ্য আর নেই।',
    'supplier-name': 'সাপ্লায়ারের নাম দিন।',
    'supplier-phone': 'এই ফোন নম্বরটি বাংলাদেশের নয়।',
};

export const purchaseTranslations = {
    en: { message: { 'bd-purchases': en } },
    bn: { message: { 'bd-purchases': bn } },
};

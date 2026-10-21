/** Catalog messages (`message.bd-catalog.<key>`) in English and Bangla. Terms follow docs/glossary.md. */
const en = {
    'sold-out': 'Sorry, just sold out: { names }. Please change the quantity or remove it from the cart.',
    'stock-reason': 'Choose why the stock changes.',
    'stock-change': 'Enter how many units to add or remove.',
    'stock-negative': 'Stock can’t go below zero.',
    'category-name': 'Give the category a name in Bangla or English.',
    'category-parent': 'A category can’t be inside itself.',
    'category-missing': 'This category doesn’t exist.',
};

const bn: typeof en = {
    'sold-out': 'দুঃখিত, এইমাত্র শেষ হয়ে গেছে: { names }। পরিমাণ বদলান বা কার্ট থেকে সরিয়ে দিন।',
    'stock-reason': 'স্টক কেন বদলাচ্ছে বেছে নিন।',
    'stock-change': 'কত পিস যোগ বা কমাবেন লিখুন।',
    'stock-negative': 'স্টক শূন্যের নিচে যেতে পারে না।',
    'category-name': 'ক্যাটাগরির নাম বাংলায় বা ইংরেজিতে দিন।',
    'category-parent': 'কোনো ক্যাটাগরি নিজের ভেতরে থাকতে পারে না।',
    'category-missing': 'এই ক্যাটাগরিটি পাওয়া যায়নি।',
};

export const catalogTranslations = {
    en: { message: { 'bd-catalog': en } },
    bn: { message: { 'bd-catalog': bn } },
};

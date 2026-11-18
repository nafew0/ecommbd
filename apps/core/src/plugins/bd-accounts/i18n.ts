/** Account messages (`message.bd-accounts.<key>`). Terms follow docs/glossary.md. */
const en = {
    'not-found': 'That record could not be found.',
    'same-account': 'Choose two different accounts.',
    'invalid-date': 'Choose a real date range, up to a year.',
    'too-many': 'That is too many rows to export. Narrow the dates and try again.',
};

const bn: typeof en = {
    'not-found': 'এটি খুঁজে পাওয়া যায়নি।',
    'same-account': 'দুটি আলাদা অ্যাকাউন্ট বাছুন।',
    'invalid-date': 'একটি সঠিক তারিখের পরিসীমা বাছুন, এক বছরের মধ্যে।',
    'too-many': 'একসাথে এত সারি এক্সপোর্ট করা যায় না। তারিখ কমিয়ে আবার চেষ্টা করুন।',
};

export const accountTranslations = {
    en: { message: { 'bd-accounts': en } },
    bn: { message: { 'bd-accounts': bn } },
};

export const csvLabels = {
    en: {
        headers: ['Date', 'Account', 'In or out', 'Amount (taka)', 'Source', 'Note'],
        in: 'In',
        out: 'Out',
        source: {
            order: 'Order',
            purchase: 'Purchase',
            expense: 'Expense',
            transfer: 'Transfer',
            manual: 'Manual entry',
        },
    },
    bn: {
        headers: ['তারিখ', 'অ্যাকাউন্ট', 'ঢোকা না বের হওয়া', 'টাকা', 'উৎস', 'নোট'],
        in: 'ঢুকেছে',
        out: 'বেরিয়েছে',
        source: {
            order: 'অর্ডার',
            purchase: 'ক্রয়',
            expense: 'খরচ',
            transfer: 'স্থানান্তর',
            manual: 'হাতে লেখা',
        },
    },
} as const;

/** Brand messages (`message.bd-brands.<key>`) in English and Bangla. */
const en = {
    missing: 'That brand could not be found.',
};

const bn: typeof en = {
    missing: 'এই ব্র্যান্ডটি পাওয়া যায়নি।',
};

export const brandTranslations = {
    en: { message: { 'bd-brands': en } },
    bn: { message: { 'bd-brands': bn } },
};

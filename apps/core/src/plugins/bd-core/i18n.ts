/**
 * Our server error messages in English and Bangla. Vendure translates an error by its key using the
 * request's language (`?languageCode=bn` on the API URL), falling back to English.
 */
export const errorTranslations = {
    en: {
        error: {
            'bd-address': {
                'district-and-thana-together': 'Send the district and the thana together.',
                'unknown-district': 'This district does not exist.',
                'thana-not-in-district': 'This thana is not in the selected district.',
                'other-needs-area': 'Write the area name when the thana is not listed.',
                'not-bangladesh': 'District and thana can only be used for addresses in Bangladesh.',
                'invalid-alternate-phone': 'The alternate phone number is not a valid Bangladeshi number.',
            },
        },
    },
    bn: {
        error: {
            'bd-address': {
                'district-and-thana-together': 'জেলা ও থানা একসাথে দিন।',
                'unknown-district': 'এই জেলাটি পাওয়া যায়নি।',
                'thana-not-in-district': 'এই থানাটি নির্বাচিত জেলার মধ্যে নয়।',
                'other-needs-area': 'থানা তালিকায় না থাকলে এলাকার নাম লিখুন।',
                'not-bangladesh': 'জেলা ও থানা শুধু বাংলাদেশের ঠিকানায় দেওয়া যায়।',
                'invalid-alternate-phone': 'বিকল্প ফোন নম্বরটি সঠিক বাংলাদেশি নম্বর নয়।',
            },
        },
    },
};

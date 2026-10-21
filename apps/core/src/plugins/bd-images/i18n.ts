/**
 * Upload errors in English and Bangla (`error.bd-image.<reason>`). Also replaces Vendure's message
 * for a refused file type ("The MIME type … is not permitted"), which the Dashboard shows.
 */
export const imageTranslations = {
    en: {
        error: {
            'bd-image': {
                'too-large': 'Image too large. Please upload an image under 15 MB.',
                'too-many-pixels':
                    'This image has too many pixels (over 40 megapixels). Please make it smaller and try again.',
                heic: 'Please upload JPG or PNG. iPhone HEIC photos are not supported yet.',
                unsupported: 'Please upload JPG or PNG (WebP, GIF and AVIF also work).',
                unreadable: 'This image file is damaged or incomplete. Please try another file.',
            },
        },
        errorResult: {
            MIME_TYPE_ERROR: 'Please upload JPG or PNG (WebP, GIF and AVIF also work).',
        },
    },
    bn: {
        error: {
            'bd-image': {
                'too-large': 'ছবিটি অনেক বড়। ১৫ MB-এর কম আকারের ছবি দিন।',
                'too-many-pixels':
                    'ছবিটিতে অনেক বেশি পিক্সেল (৪০ মেগাপিক্সেলের বেশি)। ছোট করে আবার চেষ্টা করুন।',
                heic: 'JPG বা PNG ছবি দিন। iPhone-এর HEIC ছবি এখনো নেওয়া যায় না।',
                unsupported: 'JPG বা PNG ছবি দিন (WebP, GIF ও AVIF-ও চলবে)।',
                unreadable: 'ছবির ফাইলটি নষ্ট বা অসম্পূর্ণ। অন্য একটি ফাইল দিন।',
            },
        },
        errorResult: {
            MIME_TYPE_ERROR: 'JPG বা PNG ছবি দিন (WebP, GIF ও AVIF-ও চলবে)।',
        },
    },
};

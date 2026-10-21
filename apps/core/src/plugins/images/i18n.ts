import type { ImageErrorCode } from './image-processing';

/** Why an image was refused (`message.images.<code>`), and Vendure's own wrong-type error. */
const en: Record<ImageErrorCode, string> = {
    TOO_LARGE: 'Image too large. Please upload an image under 15 MB.',
    TOO_MANY_PIXELS: 'This image is too big (more than 40 megapixels). Please make it smaller.',
    UNSUPPORTED: 'Please upload a JPG, PNG or WebP image.',
    HEIC: 'iPhone HEIC photos can’t be used. Please upload JPG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible).',
    CORRUPT: 'This image file is damaged or incomplete. Please try another file.',
};

const bn: Record<ImageErrorCode, string> = {
    TOO_LARGE: 'ছবিটি অনেক বড়। ১৫ মেগাবাইটের ছোট ছবি দিন।',
    TOO_MANY_PIXELS: 'ছবিটি অনেক বড় (৪০ মেগাপিক্সেলের বেশি)। ছোট করে দিন।',
    UNSUPPORTED: 'JPG, PNG বা WebP ছবি দিন।',
    HEIC: 'আইফোনের HEIC ছবি ব্যবহার করা যায় না। JPG বা PNG দিন (আইফোনে: Settings → Camera → Formats → Most Compatible)।',
    CORRUPT: 'ছবির ফাইলটি নষ্ট বা অসম্পূর্ণ। অন্য ফাইল দিন।',
};

export const imageTranslations = {
    en: { message: { images: en }, errorResult: { MIME_TYPE_ERROR: en.UNSUPPORTED } },
    bn: { message: { images: bn }, errorResult: { MIME_TYPE_ERROR: bn.UNSUPPORTED } },
};

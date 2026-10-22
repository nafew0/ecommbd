import { defineSection } from '../define';
import { field } from '../fields';
import { buttonLabel, heading, L, text } from './common';

export const productGrid = defineSection({
    type: 'product-grid',
    version: 1,
    name: { bn: 'পণ্যের গ্রিড', en: 'Product grid' },
    description: {
        bn: 'নতুন, জনপ্রিয়, একটি ক্যাটাগরির বা বাছাই করা পণ্য',
        en: 'New, popular, one category’s or hand-picked products',
    },
    category: 'products',
    icon: 'product-grid',
    fields: {
        heading: heading({ bn: 'নতুন এসেছে', en: 'New arrivals' }),
        text: text(),
        source: field.select(
            { bn: 'কোন পণ্য', en: 'Which products' },
            [
                { value: 'newest', label: { bn: 'সবচেয়ে নতুন', en: 'Newest' } },
                { value: 'popular', label: { bn: 'সবচেয়ে বেশি বিক্রি', en: 'Best selling' } },
                { value: 'collection', label: { bn: 'একটি ক্যাটাগরি থেকে', en: 'From a category' } },
                { value: 'manual', label: { bn: 'নিজে বাছাই করুন', en: 'Pick products' } },
            ],
            'newest',
        ),
        collection: field.collection(
            { bn: 'ক্যাটাগরি', en: 'Category' },
            { when: { source: ['collection'] } },
        ),
        products: field.productList({ bn: 'পণ্য', en: 'Products' }, 24, { when: { source: ['manual'] } }),
        count: field.range({ bn: 'কয়টি পণ্য', en: 'How many products' }, { min: 2, max: 24 }, 8, {
            when: { source: ['newest', 'popular', 'collection'] },
        }),
        columns: field.range(L.columns, { min: 2, max: 5 }, 4),
        phoneColumns: field.select(
            { bn: 'ফোনে কলাম', en: 'Columns on phones' },
            [
                { value: '1', label: { bn: '১টি', en: '1' } },
                { value: '2', label: { bn: '২টি', en: '2' } },
            ],
            '2',
        ),
        viewAll: field.toggle({ bn: '"সব দেখুন" লিংক', en: '"View all" link' }, true),
    },
});

export const collectionList = defineSection({
    type: 'collection-list',
    version: 1,
    name: { bn: 'ক্যাটাগরি তালিকা', en: 'Category list' },
    description: {
        bn: 'ক্যাটাগরিগুলো ছবি সহ; কিছু না বাছলে প্রধান ক্যাটাগরিগুলো দেখায়',
        en: 'Categories with their images; shows the main categories until you pick some',
    },
    category: 'products',
    icon: 'collection-list',
    fields: {
        heading: heading({ bn: 'ক্যাটাগরি অনুযায়ী কিনুন', en: 'Shop by category' }),
        collections: field.collectionList({ bn: 'ক্যাটাগরি', en: 'Categories' }, 12, {
            hint: { bn: 'খালি রাখলে প্রধান ক্যাটাগরিগুলো', en: 'Leave empty for the main categories' },
        }),
        columns: field.range(L.columns, { min: 2, max: 6 }, 4),
        look: field.select(
            { bn: 'দেখতে', en: 'Look' },
            [
                { value: 'tiles', label: { bn: 'ছবির নিচে নাম', en: 'Name below the image' } },
                { value: 'overlay', label: { bn: 'ছবির ওপর নাম', en: 'Name on the image' } },
            ],
            'tiles',
        ),
    },
});

export const featuredProduct = defineSection({
    type: 'featured-product',
    version: 1,
    name: { bn: 'বিশেষ পণ্য', en: 'Featured product' },
    description: {
        bn: 'একটি পণ্য বড় করে: ছবি, দাম, বিবরণ আর অর্ডারের বাটন',
        en: 'One product, large: image, price, description and an order button',
    },
    category: 'products',
    icon: 'featured-product',
    fields: {
        product: field.product({ bn: 'পণ্য', en: 'Product' }),
        badge: field.text({ bn: 'ব্যাজ', en: 'Badge' }, undefined, { max: 40 }),
        showDescription: field.toggle({ bn: 'বিবরণ দেখান', en: 'Show the description' }, true),
        button: buttonLabel({ bn: 'এখনই অর্ডার করুন', en: 'Order now' }),
        imagePosition: field.select(
            { bn: 'ছবি', en: 'Image' },
            [
                { value: 'left', label: { bn: 'বাঁয়ে', en: 'Left' } },
                { value: 'right', label: { bn: 'ডানে', en: 'Right' } },
            ],
            'left',
        ),
    },
});

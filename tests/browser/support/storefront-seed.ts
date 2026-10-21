import sharp from 'sharp';
import type { ApiSession } from './store-api';

/**
 * A small store for the storefront tests (roadmap phase 12), created once through the Admin API
 * and kept in the dev database: nested categories in Bangla and English, 50 products (photos,
 * variations, one with no photo, one out of stock, one with a very long name, Bangla slugs), an
 * "About us" page and menus. Everything is named "sf-…" so it's easy to recognize.
 */

export interface StorefrontFixtures {
    /** A product with photos and three variations. */
    panjabi: { en: string; bn: string };
    noImage: string;
    soldOut: string;
    longName: string;
    /** Collections: parent → child, slugs per language. */
    men: { en: string; bn: string };
    menPanjabi: { en: string; bn: string };
    page: { en: string; bn: string };
}

const FIXTURES: StorefrontFixtures = {
    panjabi: { en: 'sf-cotton-panjabi', bn: 'সুতির-পাঞ্জাবি' },
    noImage: 'sf-plain-lungi',
    soldOut: 'sf-silk-saree-sold-out',
    longName: 'sf-long-name-three-piece',
    men: { en: 'sf-men', bn: 'পুরুষ' },
    menPanjabi: { en: 'sf-panjabi', bn: 'পাঞ্জাবি' },
    page: { en: 'sf-about-us', bn: 'আমাদের-কথা' },
};

const COLOURS = ['#0f766e', '#b45309', '#1d4ed8', '#be123c', '#4d7c0f', '#7c3aed'];

/** A product-like photo: a coloured garment shape on a light background. */
function photo(colour: string, index: number): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
        <rect width="1200" height="1200" fill="#f1f5f9"/>
        <path d="M420 200 L600 260 L780 200 L1000 380 L900 520 L820 460 L820 1040 L380 1040 L380 460 L300 520 L200 380 Z" fill="${colour}"/>
        <circle cx="600" cy="${560 + (index % 3) * 60}" r="40" fill="#ffffff" opacity="0.6"/>
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

const PRODUCT_NAMES: Array<[string, string]> = [
    ['Cotton panjabi', 'সুতির পাঞ্জাবি'],
    ['Silk saree', 'সিল্ক শাড়ি'],
    ['Three-piece', 'থ্রি-পিস'],
    ['Kurti', 'কুর্তি'],
    ['Lungi', 'লুঙ্গি'],
    ['Fatua', 'ফতুয়া'],
    ['Shawl', 'শাল'],
    ['Hijab', 'হিজাব'],
    ['Jamdani saree', 'জামদানি শাড়ি'],
    ['Kids frock', 'বাচ্চাদের ফ্রক'],
];

function collectionInput(
    names: [string, string],
    slugs: { en: string; bn: string },
    productIds: string[],
    parentId?: string,
) {
    return {
        ...(parentId ? { parentId } : {}),
        inheritFilters: false,
        filters: [
            {
                code: 'product-id-filter',
                arguments: [
                    { name: 'productIds', value: JSON.stringify(productIds) },
                    { name: 'combineWithAnd', value: 'false' },
                ],
            },
        ],
        translations: [
            {
                languageCode: 'en',
                name: names[0],
                slug: slugs.en,
                description: `All ${names[0].toLowerCase()} in one place.`,
            },
            {
                languageCode: 'bn',
                name: names[1],
                slug: slugs.bn,
                description: `সব ${names[1]} এক জায়গায়।`,
            },
        ],
    };
}

async function createProduct(
    admin: ApiSession,
    input: {
        en: [string, string];
        bn: [string, string];
        description: { en: string; bn: string };
        assetIds: string[];
        variants: Array<{
            sku: string;
            price: number;
            stock: number;
            en: string;
            bn: string;
            optionId?: string;
        }>;
        /** For several variants: the option group (Size) they choose from. */
        optionGroupId?: string;
        enabled?: boolean;
    },
): Promise<string> {
    const { createProduct } = await admin.query(
        `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
        {
            input: {
                enabled: input.enabled ?? true,
                featuredAssetId: input.assetIds[0],
                assetIds: input.assetIds,
                translations: [
                    {
                        languageCode: 'en',
                        name: input.en[0],
                        slug: input.en[1],
                        description: input.description.en,
                    },
                    {
                        languageCode: 'bn',
                        name: input.bn[0],
                        slug: input.bn[1],
                        description: input.description.bn,
                    },
                ],
            },
        },
    );
    if (input.optionGroupId) {
        await admin.query(
            `mutation ($productId: ID!, $optionGroupId: ID!) { addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) { id } }`,
            { productId: createProduct.id, optionGroupId: input.optionGroupId },
        );
    }
    await admin.query(
        `mutation ($input: [CreateProductVariantInput!]!) { createProductVariants(input: $input) { id } }`,
        {
            input: input.variants.map(variant => ({
                productId: createProduct.id,
                ...(variant.optionId ? { optionIds: [variant.optionId] } : {}),
                sku: variant.sku,
                price: variant.price,
                stockOnHand: variant.stock,
                trackInventory: 'TRUE',
                translations: [
                    { languageCode: 'en', name: variant.en },
                    { languageCode: 'bn', name: variant.bn },
                ],
            })),
        },
    );
    return createProduct.id as string;
}

/** Removes what an interrupted earlier run left, so slugs don't get a `-1` suffix. */
async function clearPartialFixtures(admin: ApiSession) {
    const { products } = await admin.query(
        `{ products(options: { filter: { slug: { contains: "sf-" } }, take: 100 }) { items { id } } }`,
    );
    for (const product of products.items) {
        await admin.query(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: product.id });
    }
    const { collections } = await admin.query(
        `{ collections(options: { filter: { slug: { contains: "sf-" } }, take: 100 }) { items { id } } }`,
    );
    for (const collection of collections.items) {
        await admin.query(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, {
            id: collection.id,
        });
    }
}

export async function ensureStorefrontFixtures(admin: ApiSession): Promise<StorefrontFixtures> {
    // The last thing created: when it exists, everything else does.
    const { collections } = await admin.query(
        `{ collections(options: { filter: { slug: { eq: "sf-women" } } }) { totalItems } }`,
    );
    if (collections.totalItems) return FIXTURES;
    await clearPartialFixtures(admin);

    const assetIds: string[] = [];
    for (const [index, colour] of COLOURS.entries()) {
        assetIds.push(
            await admin.uploadImage(await photo(colour, index), `sf-photo-${index + 1}.jpg`, 'image/jpeg'),
        );
    }

    const { productOptionGroups } = await admin.query(
        `{ productOptionGroups(options: { filter: { code: { eq: "sf-size" } } }) { items { id options { id code } } } }`,
    );
    const size =
        productOptionGroups.items[0] ??
        (
            await admin.query(
                `mutation ($input: CreateProductOptionGroupInput!) { createProductOptionGroup(input: $input) { id options { id code } } }`,
                {
                    input: {
                        code: 'sf-size',
                        translations: [
                            { languageCode: 'en', name: 'Size' },
                            { languageCode: 'bn', name: 'সাইজ' },
                        ],
                        options: [
                            ['m', 'Medium', 'মিডিয়াম'],
                            ['l', 'Large', 'লার্জ'],
                            ['xl', 'Extra large', 'এক্সট্রা লার্জ'],
                        ].map(([code, en, bn]) => ({
                            code,
                            translations: [
                                { languageCode: 'en', name: en },
                                { languageCode: 'bn', name: bn },
                            ],
                        })),
                    },
                },
            )
        ).createProductOptionGroup;
    const option = (code: string) =>
        size.options.find((candidate: { code: string }) => candidate.code === code).id;

    const menIds: string[] = [];
    const panjabiIds: string[] = [];
    menIds.push(
        await createProduct(admin, {
            en: ['Cotton panjabi', FIXTURES.panjabi.en],
            bn: ['সুতির পাঞ্জাবি', FIXTURES.panjabi.bn],
            description: {
                en: '<p>Soft <strong>cotton</strong> panjabi for Eid.</p><ul><li>Machine wash</li><li>Made in Bangladesh</li></ul>',
                bn: 'ঈদের জন্য নরম সুতির পাঞ্জাবি।\nমেশিনে ধোয়া যায়।',
            },
            assetIds: assetIds.slice(0, 3),
            optionGroupId: size.id,
            variants: [
                {
                    sku: 'SF-PANJABI-M',
                    price: 125000,
                    stock: 20,
                    en: 'Medium',
                    bn: 'মিডিয়াম',
                    optionId: option('m'),
                },
                {
                    sku: 'SF-PANJABI-L',
                    price: 135000,
                    stock: 3,
                    en: 'Large',
                    bn: 'লার্জ',
                    optionId: option('l'),
                },
                {
                    sku: 'SF-PANJABI-XL',
                    price: 145000,
                    stock: 0,
                    en: 'Extra large',
                    bn: 'এক্সট্রা লার্জ',
                    optionId: option('xl'),
                },
            ],
        }),
    );
    panjabiIds.push(menIds[0]!);
    menIds.push(
        await createProduct(admin, {
            en: ['Plain lungi', FIXTURES.noImage],
            bn: ['সাধারণ লুঙ্গি', 'সাধারণ-লুঙ্গি'],
            description: { en: 'Everyday cotton lungi.', bn: 'প্রতিদিনের সুতির লুঙ্গি।' },
            assetIds: [],
            variants: [{ sku: 'SF-LUNGI', price: 45000, stock: 50, en: 'Plain lungi', bn: 'সাধারণ লুঙ্গি' }],
        }),
    );
    const womenIds: string[] = [];
    womenIds.push(
        await createProduct(admin, {
            en: ['Silk saree (sold out)', FIXTURES.soldOut],
            bn: ['সিল্ক শাড়ি (শেষ)', 'সিল্ক-শাড়ি-শেষ'],
            description: { en: 'Pure silk.', bn: 'খাঁটি সিল্ক।' },
            assetIds: [assetIds[3]!],
            variants: [
                { sku: 'SF-SAREE-SOLD', price: 450000, stock: 0, en: 'Silk saree', bn: 'সিল্ক শাড়ি' },
            ],
        }),
    );
    womenIds.push(
        await createProduct(admin, {
            en: [
                'Embroidered georgette three-piece with chiffon dupatta, lined salwar and matching hand-stitched details for weddings',
                FIXTURES.longName,
            ],
            bn: [
                'বিয়ের জন্য শিফন ওড়না, লাইনিং দেওয়া সালোয়ার ও হাতের কাজ করা মানানসই নকশার জর্জেট থ্রি-পিস',
                'লম্বা-নামের-থ্রি-পিস',
            ],
            description: { en: 'Long name test.'.repeat(20), bn: 'লম্বা বিবরণ। '.repeat(40) },
            assetIds: [assetIds[4]!],
            variants: [{ sku: 'SF-LONG', price: 320000, stock: 5, en: 'Three-piece', bn: 'থ্রি-পিস' }],
        }),
    );
    // The rest: 46 simple products across both categories, for lists and pagination.
    for (let index = 0; index < 46; index++) {
        const [en, bn] = PRODUCT_NAMES[index % PRODUCT_NAMES.length]!;
        const number = index + 1;
        const id = await createProduct(admin, {
            en: [`${en} ${number}`, `sf-${en.toLowerCase().replace(/\s+/g, '-')}-${number}`],
            bn: [`${bn} ${number}`, `${bn.replace(/\s+/g, '-')}-${number}`],
            description: { en: `${en} number ${number}.`, bn: `${bn} নম্বর ${number}।` },
            assetIds: [assetIds[index % assetIds.length]!],
            variants: [
                {
                    sku: `SF-${number}`,
                    price: 50000 + number * 1000,
                    stock: 10,
                    en: `${en} ${number}`,
                    bn: `${bn} ${number}`,
                },
            ],
        });
        (index % 2 ? womenIds : menIds).push(id);
        if (index % 2 === 0 && index < 20) panjabiIds.push(id);
    }

    const create = (input: unknown) =>
        admin.query(`mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`, {
            input,
        });
    const men = await create(collectionInput(['Men', 'পুরুষ'], FIXTURES.men, menIds));
    await create(
        collectionInput(['Panjabi', 'পাঞ্জাবি'], FIXTURES.menPanjabi, panjabiIds, men.createCollection.id),
    );
    await create(collectionInput(['Women', 'নারী'], { en: 'sf-women', bn: 'নারী' }, womenIds));

    const { saveBdPage } = await admin.query(
        `mutation ($input: JSON!) { saveBdPage(input: $input) { page { id } errors { path code } } }`,
        {
            input: {
                enabled: true,
                translations: {
                    en: {
                        title: 'About us',
                        slug: FIXTURES.page.en,
                        body: '<p>We are a family shop in <strong>Dhaka</strong>.</p>',
                        seoTitle: 'About our shop',
                        seoDescription: 'A family shop in Dhaka since 2010.',
                    },
                    bn: {
                        title: 'আমাদের কথা',
                        slug: FIXTURES.page.bn,
                        body: 'আমরা ঢাকার একটি পারিবারিক দোকান।',
                        seoTitle: '',
                        seoDescription: '',
                    },
                },
            },
        },
    );
    const { bdMenus } = await admin.query('{ bdMenus }');
    await admin.query(`mutation ($input: JSON!) { updateBdMenus(input: $input) { errors { path code } } }`, {
        input: {
            header: [
                {
                    label: { bn: 'পুরুষ', en: 'Men' },
                    link: { type: 'category', id: men.createCollection.id },
                    children: [],
                },
                {
                    label: { bn: 'আমাদের কথা', en: 'About us' },
                    link: { type: 'page', id: saveBdPage.page.id },
                    children: [],
                },
            ],
            footer: bdMenus.footer,
        },
    });
    return FIXTURES;
}

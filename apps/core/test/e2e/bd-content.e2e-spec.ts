import { defaultMenus } from '@ecommbd/shared';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3059;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

const CREATE_PRODUCT = gql`
    mutation ($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
            slug
            description
        }
    }
`;
const UPDATE_PRODUCT = gql`
    mutation ($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            slug
        }
    }
`;
const LOOKUP = gql`
    query ($type: String!, $slug: String!) {
        bdSlugLookup(type: $type, slug: $slug) {
            status
            slug
        }
    }
`;
const SAVE_PAGE = gql`
    mutation ($id: ID, $input: JSON!) {
        saveBdPage(id: $id, input: $input) {
            page {
                id
                enabled
                translations {
                    languageCode
                    title
                    slug
                    body
                }
            }
            errors {
                path
                code
            }
        }
    }
`;
const SHOP_PAGE = gql`
    query ($slug: String!) {
        bdPage(slug: $slug) {
            id
            translations {
                languageCode
                title
                slug
                body
            }
        }
    }
`;
const SHOP_MENUS = gql`
    query {
        bdMenus {
            header {
                label
                url
                children {
                    label
                    url
                }
            }
            footer {
                label
                url
            }
        }
    }
`;

const en = (name: string, slug: string, description = '') => ({
    languageCode: 'en',
    name,
    slug,
    description,
});
const bn = (name: string, slug: string, description = '') => ({
    languageCode: 'bn',
    name,
    slug,
    description,
});
const pageText = (title: string, slug = '', body = '') => ({
    title,
    slug,
    body,
    seoTitle: '',
    seoDescription: '',
});

async function createProduct(translations: unknown[], enabled = true) {
    const { createProduct } = await adminClient.query<{
        createProduct: { id: string; slug: string; description: string };
    }>(CREATE_PRODUCT, { input: { enabled, translations } });
    return createProduct;
}

/** Slug history is written from Vendure's events, just after the change commits. */
async function lookup(type: string, slug: string, language = 'en') {
    for (let attempt = 0; attempt < 50; attempt++) {
        const result = await shopClient.query<{
            bdSlugLookup: { status: string; slug: string | null } | null;
        }>(LOOKUP, { type, slug }, { languageCode: language });
        if (result.bdSlugLookup) return result.bdSlugLookup;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

describe('storefront content (phase 12)', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('redirects old product slugs straight to the current one, and deleted products are gone', async () => {
        const product = await createProduct([
            en('Silk saree', 'silk-saree'),
            bn('সিল্ক শাড়ি', 'সিল্ক-শাড়ি'),
        ]);
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: product.id, translations: [en('Silk saree', 'silk-saree-red')] },
        });
        expect(await lookup('product', 'silk-saree')).toEqual({ status: 'moved', slug: 'silk-saree-red' });
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: product.id, translations: [en('Silk saree', 'silk-saree-maroon')] },
        });
        // A → B → C: the first slug goes straight to C, no chain.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(await lookup('product', 'silk-saree')).toEqual({ status: 'moved', slug: 'silk-saree-maroon' });
        expect(await lookup('product', 'silk-saree-red')).toEqual({
            status: 'moved',
            slug: 'silk-saree-maroon',
        });

        // The Bangla slug is found whichever Unicode form the request uses.
        const { bdSlugLookup: current } = await shopClient.query(LOOKUP, {
            type: 'product',
            slug: 'সিল্ক-শাড়ি'.normalize('NFC'),
        });
        expect(current).toBeNull();

        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    deleteProduct(id: $id) {
                        result
                    }
                }
            `,
            { id: product.id },
        );
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(await lookup('product', 'silk-saree-maroon')).toEqual({ status: 'gone', slug: null });
        expect(await lookup('product', 'silk-saree')).toEqual({ status: 'gone', slug: null });
    });

    it('knows nothing about a disabled product’s current slug (a plain 404) or an unknown one', async () => {
        await createProduct([en('Hidden kurti', 'hidden-kurti')], false);
        await new Promise(resolve => setTimeout(resolve, 300));
        const { bdSlugLookup } = await shopClient.query(LOOKUP, { type: 'product', slug: 'hidden-kurti' });
        expect(bdSlugLookup).toBeNull();
        expect((await shopClient.query(LOOKUP, { type: 'nonsense', slug: 'x' })).bdSlugLookup).toBeNull();
    });

    it('sanitizes HTML descriptions on save and leaves plain text as typed', async () => {
        const html = await createProduct([
            en(
                'Panjabi',
                'panjabi',
                '<p onclick="x()">Soft <b>cotton</b></p><script>alert(1)</script>[vc_row]',
            ),
        ]);
        expect(html.description).toBe('<p>Soft <b>cotton</b></p>');
        const text = await createProduct([en('Lungi', 'lungi', 'Size: M & L\nPrice < 500')]);
        expect(text.description).toBe('Size: M & L\nPrice < 500');
    });

    it('stores SEO fields per language and shows them in the Shop API', async () => {
        const product = await createProduct([
            {
                ...en('Three-piece', 'three-piece'),
                customFields: { seoTitle: 'Cotton three-piece', seoDescription: 'Soft' },
            },
        ]);
        const { product: shop } = await shopClient.query(
            gql`
                query ($id: ID!) {
                    product(id: $id) {
                        customFields {
                            seoTitle
                            seoDescription
                        }
                    }
                }
            `,
            { id: product.id },
        );
        expect(shop.customFields).toEqual({ seoTitle: 'Cotton three-piece', seoDescription: 'Soft' });
    });

    it('saves pages in both languages, sanitized, with clear errors', async () => {
        const { saveBdPage } = await adminClient.query(SAVE_PAGE, {
            input: {
                enabled: true,
                translations: {
                    bn: pageText('আমাদের কথা', '', 'আমরা ঢাকার দোকান।'),
                    en: pageText('About us', '', '<h1>Hello</h1><script>x()</script><p>We are in Dhaka.</p>'),
                },
            },
        });
        expect(saveBdPage.errors).toEqual([]);
        const byLanguage = Object.fromEntries(
            saveBdPage.page.translations.map((t: { languageCode: string }) => [t.languageCode, t]),
        );
        expect(byLanguage.en).toMatchObject({
            slug: 'about-us',
            body: '<h2>Hello</h2><p>We are in Dhaka.</p>',
        });
        expect(byLanguage.bn.slug.normalize('NFC')).toBe('আমাদের-কথা');

        // Found by either language's slug, and by either Unicode form.
        const bySlug = await shopClient.query(SHOP_PAGE, { slug: 'আমাদের-কথা'.normalize('NFC') });
        expect(bySlug.bdPage.id).toBe(saveBdPage.page.id);

        const clash = await adminClient.query(SAVE_PAGE, {
            input: { enabled: true, translations: { bn: pageText(''), en: pageText('About', 'about-us') } },
        });
        expect(clash.saveBdPage.errors).toEqual([{ path: 'translations.en.slug', code: 'taken' }]);
        const reserved = await adminClient.query(SAVE_PAGE, {
            input: {
                enabled: true,
                translations: { bn: pageText(''), en: pageText('Checkout', 'checkout') },
            },
        });
        expect(reserved.saveBdPage.errors).toEqual([{ path: 'translations.en.slug', code: 'reserved' }]);

        // Renamed: the old slug redirects; disabled: not shown; deleted: gone.
        await adminClient.query(SAVE_PAGE, {
            id: saveBdPage.page.id,
            input: {
                enabled: false,
                translations: { bn: pageText(''), en: pageText('About us', 'our-story') },
            },
        });
        expect((await shopClient.query(SHOP_PAGE, { slug: 'our-story' })).bdPage).toBeNull();
        expect(await lookup('page', 'about-us')).toEqual({ status: 'moved', slug: 'our-story' });
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    deleteBdPage(id: $id)
                }
            `,
            { id: saveBdPage.page.id },
        );
        expect(await lookup('page', 'our-story')).toEqual({ status: 'gone', slug: null });
    });

    it('resolves menus to paths in each language, nested categories included', async () => {
        const { shopMenus } = { shopMenus: await shopClient.query(SHOP_MENUS) };
        expect(shopMenus.bdMenus.footer.map((link: { url: string }) => link.url)).toEqual([
            '/return-policy/',
            '/refund-policy/',
            '/privacy-policy/',
            '/terms/',
        ]);

        const createCollection = gql`
            mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) {
                    id
                }
            }
        `;
        const parent = await adminClient.query(createCollection, {
            input: {
                filters: [],
                translations: [en('Women', 'women', ''), bn('নারী', 'নারী', '')],
            },
        });
        const child = await adminClient.query(createCollection, {
            input: {
                parentId: parent.createCollection.id,
                filters: [],
                translations: [en('Sarees', 'sarees', ''), bn('শাড়ি', 'শাড়ি', '')],
            },
        });
        const product = await createProduct([en('Jamdani', 'jamdani'), bn('জামদানি', 'জামদানি')]);
        const page = await adminClient.query(SAVE_PAGE, {
            input: { enabled: true, translations: { bn: pageText('সাইজ গাইড'), en: pageText('Size guide') } },
        });
        const menus = {
            header: [
                {
                    label: { bn: 'নারী', en: 'Women' },
                    link: { type: 'category', id: parent.createCollection.id },
                    children: [
                        {
                            label: { bn: 'শাড়ি', en: '' },
                            link: { type: 'category', id: child.createCollection.id },
                        },
                    ],
                },
                { label: { bn: '', en: 'Jamdani' }, link: { type: 'product', id: product.id }, children: [] },
                {
                    label: { bn: 'সাইজ', en: 'Sizes' },
                    link: { type: 'page', id: page.saveBdPage.page.id },
                    children: [],
                },
                { label: { bn: 'পুরোনো', en: 'Old' }, link: { type: 'product', id: '99999' }, children: [] },
            ],
            footer: defaultMenus().footer,
        };
        const { updateBdMenus } = await adminClient.query(
            gql`
                mutation ($input: JSON!) {
                    updateBdMenus(input: $input) {
                        errors {
                            path
                            code
                        }
                    }
                }
            `,
            { input: menus },
        );
        expect(updateBdMenus.errors).toEqual([]);

        const english = await shopClient.query(SHOP_MENUS, {}, { languageCode: 'en' });
        expect(english.bdMenus.header).toEqual([
            {
                label: 'Women',
                url: '/product-category/women/',
                children: [{ label: 'শাড়ি', url: '/product-category/women/sarees/' }],
            },
            { label: 'Jamdani', url: '/product/jamdani/', children: [] },
            { label: 'Sizes', url: '/size-guide/', children: [] },
        ]);
        const bangla = await shopClient.query(SHOP_MENUS, {}, { languageCode: 'bn' });
        expect(bangla.bdMenus.header[0].children[0].url).toBe(
            `/product-category/${encodeURIComponent('নারী')}/${encodeURIComponent('শাড়ি')}/`,
        );
        expect(bangla.bdMenus.header[1].label).toBe('Jamdani');
        expect(bangla.bdMenus.footer[0]).toEqual({ label: 'রিটার্ন নীতি', url: '/return-policy/' });

        const bad = await adminClient.query(
            gql`
                mutation ($input: JSON!) {
                    updateBdMenus(input: $input) {
                        menus
                        errors {
                            path
                            code
                        }
                    }
                }
            `,
            {
                input: {
                    header: [{ label: { bn: '', en: '' }, link: { type: 'url', url: 'javascript:x' } }],
                    footer: [],
                },
            },
        );
        expect(bad.updateBdMenus.menus).toBeNull();
        expect(bad.updateBdMenus.errors.map((error: { code: string }) => error.code)).toContain('invalidUrl');
    });

    it('gives the content permission to the owner, manager and marketing roles only', async () => {
        const { roles } = await adminClient.query(gql`
            query {
                roles {
                    items {
                        code
                        permissions
                    }
                }
            }
        `);
        const withContent = roles.items
            .filter(
                (role: { code: string; permissions: string[] }) =>
                    role.permissions.includes('ManageContent') && role.code !== '__super_admin_role__',
            )
            .map((role: { code: string }) => role.code)
            .sort();
        expect(withContent).toEqual(['manager', 'marketing', 'owner']);
    });
});

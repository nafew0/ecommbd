import {
    createSection,
    defaultThemeSettings,
    type LayoutDocument,
    SECTIONS,
    type SectionData,
    THEMES,
} from '@ecommbd/sections';
import { expect, test } from '@playwright/test';
import { publishLayout, setTheme, waitForStorefront } from '../browser/support/sections';
import { adminSession, type ApiSession } from '../browser/support/store-api';
import { ensureStorefrontFixtures } from '../browser/support/storefront-seed';

/**
 * Every section (roadmap phase 15) on one page, in both themes and both languages, compared with
 * its saved snapshot. The page uses the storefront test store's own products, categories and
 * photos, so it looks the same on every run.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const PAGE_SLUG = { en: 'visual-sections', bn: 'ভিজ্যুয়াল-সেকশন' };

let admin: ApiSession;

const text = (en: string, bn: string) => ({ bn, en });

async function ids(api: ApiSession) {
    const { products } = await api.query(
        `{ products(options: { filter: { slug: { in: ["sf-cotton-panjabi", "sf-silk-saree-sold-out", "sf-long-name-three-piece", "sf-plain-lungi"] } } }) {
            items { id slug assets { id preview } } } }`,
    );
    const bySlug = (slug: string) => products.items.find((item: { slug: string }) => item.slug === slug);
    const panjabi = bySlug('sf-cotton-panjabi');
    const { collections } = await api.query(
        `{ collections(options: { filter: { slug: { in: ["sf-men", "sf-women", "sf-panjabi"] } } }) { items { id slug } } }`,
    );
    const photos = panjabi.assets.map((asset: { id: string; preview: string }) => ({
        assetId: asset.id,
        preview: asset.preview,
    }));
    return {
        products: [
            'sf-cotton-panjabi',
            'sf-silk-saree-sold-out',
            'sf-long-name-three-piece',
            'sf-plain-lungi',
        ].map(slug => bySlug(slug).id as string),
        collections: collections.items.map((item: { id: string }) => item.id as string),
        photos: photos as Array<{ assetId: string; preview: string }>,
    };
}

/** All eighteen sections with realistic Bangla and English content. */
function gallery(refs: Awaited<ReturnType<typeof ids>>): LayoutDocument {
    const photo = (index: number) => refs.photos[index % refs.photos.length]!;
    const sections: SectionData[] = SECTIONS.map(definition => createSection(definition.type));
    const byType = (type: string) => sections.find(section => section.type === type)!;
    const set = (type: string, settings: Record<string, unknown>) =>
        Object.assign(byType(type).settings, settings);

    set('hero', { image: photo(0), badge: text('15% off', '১৫% ছাড়'), height: 'm' });
    byType('slideshow').blocks.forEach((block, index) =>
        Object.assign(block.settings, { image: photo(index + 1) }),
    );
    set('banner', { image: photo(2) });
    set('product-grid', { source: 'manual', products: refs.products, columns: 4 });
    set('collection-list', { collections: refs.collections });
    set('featured-product', { product: refs.products[0], badge: text('Best seller', 'সবচেয়ে জনপ্রিয়') });
    set('image-with-text', { image: photo(1) });
    byType('image-grid').blocks.forEach((block, index) =>
        Object.assign(block.settings, {
            image: photo(index),
            caption: text(`Look ${index + 1}`, `লুক ${index + 1}`),
        }),
    );
    set('video', {
        video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        poster: photo(3),
        caption: text('How we stitch', 'যেভাবে আমরা সেলাই করি'),
    });
    byType('testimonials').blocks.forEach((block, index) =>
        Object.assign(block.settings, {
            name: text(['Nusrat', 'Farhan', 'Tania'][index]!, ['নুসরাত', 'ফারহান', 'তানিয়া'][index]!),
            place: text('Dhaka', 'ঢাকা'),
            text: text(
                'The fabric is soft and the stitching is neat. Delivery took two days.',
                'কাপড় নরম, সেলাই সুন্দর। দুই দিনে ডেলিভারি পেয়েছি।',
            ),
            rating: 5 - index,
        }),
    );
    byType('testimonials').hidden = false;
    return { sections };
}

test.describe('sections, as shoppers see them', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        test.setTimeout(180_000);
        admin = await adminSession();
        await ensureStorefrontFixtures(admin);
        const { bdPages } = await admin.query(
            '{ bdPages(take: 100) { items { id translations { slug } } } }',
        );
        let page = bdPages.items.find((item: { translations: Array<{ slug: string }> }) =>
            item.translations.some(translation => translation.slug === PAGE_SLUG.en),
        );
        if (!page) {
            const entry = (title: string, slug: string) => ({
                title,
                slug,
                body: '',
                seoTitle: '',
                seoDescription: '',
            });
            const { saveBdPage } = await admin.query(
                'mutation ($input: JSON!) { saveBdPage(input: $input) { page { id } } }',
                {
                    input: {
                        enabled: true,
                        translations: {
                            en: entry('All sections', PAGE_SLUG.en),
                            bn: entry('সব সেকশন', PAGE_SLUG.bn),
                        },
                    },
                },
            );
            page = saveBdPage.page;
        }
        await publishLayout(admin, 'page', gallery(await ids(admin)), page.id);
    });

    test.afterAll(async () => {
        await setTheme(admin);
    });

    for (const theme of THEMES) {
        for (const lang of ['bn', 'en'] as const) {
            test(`every section in ${theme}, ${lang === 'bn' ? 'Bangla' : 'English'}`, async ({ page }) => {
                await setTheme(admin, defaultThemeSettings(theme));
                const path =
                    lang === 'bn'
                        ? `/${encodeURIComponent(PAGE_SLUG.bn.normalize('NFC'))}/`
                        : `/en/${PAGE_SLUG.en}/`;
                await waitForStorefront(`${SITE}${path}`, html => html.includes(`data-theme="${theme}"`));
                await page.goto(`${SITE}${path}`);
                await page.evaluate(() => document.fonts.ready);
                // Lazy images: scroll through once so every one has loaded.
                for (const section of await page.locator('main > section.section').all()) {
                    await section.scrollIntoViewIfNeeded();
                }
                await page.waitForLoadState('networkidle');
                // The floating chat buttons sit over whatever section is on screen.
                await page.evaluate(() => document.querySelector('.floating-contact')?.remove());
                for (const definition of SECTIONS) {
                    const section = page.locator(`main > section.section-${definition.type}`).first();
                    await section.scrollIntoViewIfNeeded();
                    await expect(section).toHaveScreenshot(`${definition.type}-${theme}-${lang}.png`, {
                        // Contact details come from store settings, which other tests change.
                        mask: definition.type === 'contact' ? [section.locator('.contact-detail')] : [],
                    });
                }
            });
        }
    }
});

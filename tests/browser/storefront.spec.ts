import { expect, type Page, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { adminSession, type ApiSession } from './support/store-api';
import { ensureStorefrontFixtures, type StorefrontFixtures } from './support/storefront-seed';

/**
 * The storefront (roadmap phase 12), in Bangla (the default language, no prefix) and English
 * (`/en/`): pages, SEO tags and JSON-LD, redirects, 404 and 410, sitemaps, and no JavaScript.
 * Runs against `npm run start -w @ecommbd/storefront` (see playwright.config.ts).
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const enc = (slug: string) => encodeURIComponent(slug.normalize('NFC'));

let admin: ApiSession;
let fixtures: StorefrontFixtures;

test.beforeAll(async () => {
    test.setTimeout(180_000);
    admin = await adminSession();
    fixtures = await ensureStorefrontFixtures(admin);
    // The store's default language is Bangla in these tests.
    const { bdStoreSettings } = await admin.query('{ bdStoreSettings { settings } }');
    const settings = bdStoreSettings.settings;
    if (settings.locale.defaultLanguage !== 'bn' || !settings.profile.whatsapp) {
        settings.locale.defaultLanguage = 'bn';
        settings.profile.whatsapp ||= '+8801712345678';
        const { updateBdStoreSettings } = await admin.query(
            'mutation ($input: JSON!) { updateBdStoreSettings(input: $input) { errors { path code } } }',
            { input: settings },
        );
        expect(updateBdStoreSettings.errors).toEqual([]);
    }
    // New products reach the search index and categories through the worker.
    await expect
        .poll(async () => (await fetch(`${SITE}/product-category/${enc(fixtures.men.bn)}/`)).status, {
            timeout: 60_000,
        })
        .toBe(200);
    // The parent and the nested category are filled by separate jobs: wait for both.
    for (const path of [
        `/product-category/${enc(fixtures.men.bn)}/`,
        `/product-category/${enc(fixtures.men.bn)}/${enc(fixtures.menPanjabi.bn)}/`,
    ]) {
        await expect
            .poll(async () => (await (await fetch(`${SITE}${path}`)).text()).includes('card'), {
                timeout: 60_000,
            })
            .toBe(true);
    }
});

/** The head's SEO tags and JSON-LD blocks. */
async function seo(page: Page) {
    return page.evaluate(() => {
        const attr = (selector: string, name: string) =>
            document.querySelector(selector)?.getAttribute(name) ?? null;
        return {
            lang: document.documentElement.lang,
            title: document.title,
            description: attr('meta[name="description"]', 'content'),
            canonical: attr('link[rel="canonical"]', 'href'),
            robots: attr('meta[name="robots"]', 'content'),
            ogTitle: attr('meta[property="og:title"]', 'content'),
            ogType: attr('meta[property="og:type"]', 'content'),
            ogImage: attr('meta[property="og:image"]', 'content'),
            hreflang: Object.fromEntries(
                [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(link => [
                    link.getAttribute('hreflang'),
                    link.getAttribute('href'),
                ]),
            ),
            jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(script =>
                JSON.parse(script.textContent ?? 'null'),
            ),
            // Scripts written into the page (the CSP forbids them) and scripts loaded as files.
            inlineScripts: document.querySelectorAll('script:not([src]):not([type="application/ld+json"])')
                .length,
            scriptSources: [...document.querySelectorAll('script[src]')].map(script =>
                script.getAttribute('src'),
            ),
        };
    });
}

async function status(path: string) {
    const response = await fetch(`${SITE}${path}`, { redirect: 'manual' });
    return { status: response.status, location: response.headers.get('location') };
}

test.describe('storefront', () => {
    test('home in Bangla and English, with hreflang and structured data', async ({ page }) => {
        await page.goto(`${SITE}/`);
        const bn = await seo(page);
        expect(bn.lang).toBe('bn');
        expect(bn.canonical).toBe(`${SITE}/`);
        expect(bn.hreflang).toEqual({ bn: `${SITE}/`, en: `${SITE}/en/`, 'x-default': `${SITE}/` });
        expect(bn.jsonLd.map(data => data['@type'])).toEqual(['Organization', 'WebSite']);
        expect(bn.jsonLd[1].potentialAction.target.urlTemplate).toBe(
            `${SITE}/search/?q={search_term_string}`,
        );
        expect(bn.inlineScripts).toBe(0);
        // Only the small loader for search suggestions (phase 13), from our own origin.
        expect(bn.scriptSources.every(src => src?.startsWith('/_astro/'))).toBe(true);
        await expect(page.getByRole('heading', { name: 'নতুন পণ্য' })).toBeVisible();
        await expect(page.locator('.product-grid .card').first()).toBeVisible();

        await page.getByRole('link', { name: 'English' }).click();
        await expect(page).toHaveURL(`${SITE}/en/`);
        expect((await seo(page)).lang).toBe('en');
        await expect(page.getByRole('heading', { name: 'New arrivals' })).toBeVisible();
    });

    test('a product page in both languages: price, stock, SEO, JSON-LD, within the JavaScript budget', async ({
        page,
    }) => {
        const scripts: string[] = [];
        page.on('response', response => {
            if (response.request().resourceType() === 'script') scripts.push(response.url());
        });
        await page.goto(`${SITE}/product/${enc(fixtures.panjabi.bn)}/`);
        await page.waitForLoadState('networkidle');
        // First-party JavaScript on a product page: at most 30 KB gzipped (architecture.md, Decision 2).
        let gzipped = 0;
        for (const url of scripts)
            gzipped += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
        expect(gzipped).toBeLessThanOrEqual(30 * 1024);
        const bn = await seo(page);
        expect(bn.title).toContain('সুতির পাঞ্জাবি');
        expect(bn.ogType).toBe('product');
        // The largest WebP size (the seed photos are 1200 px wide).
        expect(bn.ogImage).toMatch(/\/img\/[0-9a-f]{64}\/1200\.webp$/);
        expect(bn.hreflang).toEqual({
            bn: `${SITE}/product/${enc(fixtures.panjabi.bn)}/`,
            en: `${SITE}/en/product/${fixtures.panjabi.en}/`,
            'x-default': `${SITE}/product/${enc(fixtures.panjabi.bn)}/`,
        });
        expect(bn.inlineScripts).toBe(0);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('সুতির পাঞ্জাবি');
        await expect(page.locator('.price-large')).toHaveText(/৳1,250 – ৳1,450/);
        // Vendure's default stock display says in or out of stock (no "low stock" level).
        await expect(page.locator('.stock')).toHaveText('স্টকে আছে');
        const product = bn.jsonLd.find(data => data['@type'] === 'Product');
        expect(product.offers).toHaveLength(3);
        expect(product.offers[0]).toMatchObject({
            '@type': 'Offer',
            priceCurrency: 'BDT',
            price: '1250.00',
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
        });
        expect(product.offers[2].availability).toBe('https://schema.org/OutOfStock');
        expect(product.image.length).toBe(3);
        const crumbs = bn.jsonLd.find(data => data['@type'] === 'BreadcrumbList');
        expect(crumbs.itemListElement.map((item: { name: string }) => item.name)).toEqual([
            'হোম',
            'পুরুষ',
            'পাঞ্জাবি',
            'সুতির পাঞ্জাবি',
        ]);
        // The main photo loads first; the rest wait until they're near the screen.
        const main = page.locator('.product-main-image');
        await expect(main).toHaveAttribute('fetchpriority', 'high');
        await expect(main).toHaveAttribute('srcset', /160w/);
        expect(await page.locator('link[rel="preload"][as="image"]').count()).toBe(1);
        expect(await page.locator('.product-thumbs img[loading="lazy"]').count()).toBe(2);
        // A WhatsApp order link with the product's URL; the description is sanitized HTML.
        await expect(page.getByRole('link', { name: 'হোয়াটসঅ্যাপে অর্ডার করুন' })).toHaveAttribute(
            'href',
            /^https:\/\/wa\.me\/880\d+\?text=/,
        );

        await page.goto(`${SITE}/en/product/${fixtures.panjabi.en}/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cotton panjabi');
        await expect(page.locator('.rich-text strong')).toHaveText('cotton');
        expect((await seo(page)).description).toBe(
            'Soft cotton panjabi for Eid. Machine wash Made in Bangladesh',
        );
    });

    test('a product with no photo, one sold out, and a very long name', async ({ page }) => {
        await page.goto(`${SITE}/en/product/${fixtures.noImage}/`);
        await expect(page.locator('.product-gallery .image-placeholder')).toBeVisible();
        const product = (await seo(page)).jsonLd.find(data => data['@type'] === 'Product');
        expect(product).not.toHaveProperty('image');

        await page.goto(`${SITE}/product/${fixtures.soldOut}/`);
        await expect(page.locator('.stock')).toHaveText('স্টকে নেই');
        const soldOut = (await seo(page)).jsonLd.find(data => data['@type'] === 'Product');
        expect(soldOut.offers[0].availability).toBe('https://schema.org/OutOfStock');
        expect((await seo(page)).robots).toBeNull();
        await expect(page.getByRole('link', { name: 'হোয়াটসঅ্যাপে অর্ডার করুন' })).toHaveCount(0);

        await page.goto(`${SITE}/en/product/${fixtures.longName}/`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
    });

    test('a nested category, with the full path canonical', async ({ page }) => {
        const path = `/product-category/${enc(fixtures.men.bn)}/${enc(fixtures.menPanjabi.bn)}/`;
        await page.goto(`${SITE}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('পাঞ্জাবি');
        await expect(page.locator('.product-grid .card').first()).toBeVisible();
        expect((await seo(page)).canonical).toBe(`${SITE}${path}`);
        // Without its parent, or with the English slug on the Bangla site: one 301 to the canonical path.
        expect(await status(`/product-category/${enc(fixtures.menPanjabi.bn)}/`)).toEqual({
            status: 301,
            location: path,
        });
        expect(await status(`/product-category/sf-men/sf-panjabi/`)).toEqual({ status: 301, location: path });
        // English.
        await page.goto(`${SITE}/en/product-category/sf-men/sf-panjabi/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panjabi');
    });

    test('pages and policies in both languages', async ({ page }) => {
        await page.goto(`${SITE}/${enc(fixtures.page.bn)}/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('আমাদের কথা');
        await page.goto(`${SITE}/en/${fixtures.page.en}/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('About us');
        const head = await seo(page);
        expect(head.title).toContain('About our shop');
        expect(head.description).toBe('A family shop in Dhaka since 2010.');
        expect(head.hreflang.bn).toBe(`${SITE}/${enc(fixtures.page.bn)}/`);

        await page.goto(`${SITE}/return-policy/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('রিটার্ন নীতি');
        await page.goto(`${SITE}/en/terms/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms and conditions');
        // The footer menu links the policies.
        await expect(
            page.locator('.site-footer').getByRole('link', { name: 'Privacy policy' }),
        ).toHaveAttribute('href', '/en/privacy-policy/');
    });

    test('one 301 to the canonical URL, whatever the spelling', async () => {
        const canonical = `/product/${enc(fixtures.panjabi.bn)}/`;
        expect(await status(`/product/${enc(fixtures.panjabi.bn)}`)).toEqual({
            status: 301,
            location: canonical,
        });
        // ো is one character composed (NFC, as browsers write it) and two decomposed (NFD, as Vendure stores it).
        const slug = `মোটা-লুঙ্গি-${Date.now()}`;
        await admin.query(`mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`, {
            input: { translations: [{ languageCode: 'bn', name: 'মোটা লুঙ্গি', slug, description: '' }] },
        });
        const composed = `/product/${encodeURIComponent(slug.normalize('NFC'))}/`;
        expect(composed).not.toBe(`/product/${encodeURIComponent(slug.normalize('NFD'))}/`);
        expect(await status(composed)).toEqual({ status: 200, location: null });
        expect(await status(`/product/${encodeURIComponent(slug.normalize('NFD'))}/`)).toEqual({
            status: 301,
            location: composed,
        });
        expect(await status(composed.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()))).toEqual({
            status: 301,
            location: composed,
        });
        expect(await status(canonical.toLowerCase())).toEqual({ status: 301, location: canonical });
        expect(await status(`/product/${fixtures.panjabi.en}/`)).toEqual({
            status: 301,
            location: canonical,
        });
        expect(await status('/bn/')).toEqual({ status: 301, location: '/' });
        expect(await status(`/EN/product/${fixtures.panjabi.en.toUpperCase()}`)).toEqual({
            status: 301,
            location: `/en/product/${fixtures.panjabi.en}/`,
        });
        expect(await status(`${canonical}?utm_source=fb`)).toEqual({ status: 200, location: null });
    });

    test('an old slug redirects once, a deleted product is gone, a disabled one is not found', async ({
        page,
    }) => {
        const suffix = Date.now();
        const { createProduct } = await admin.query(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        { languageCode: 'en', name: 'Rename me', slug: `sf-old-${suffix}`, description: '' },
                        { languageCode: 'bn', name: 'নাম বদল', slug: `sf-old-${suffix}`, description: '' },
                    ],
                },
            },
        );
        const rename = (slug: string) =>
            admin.query(`mutation ($input: UpdateProductInput!) { updateProduct(input: $input) { id } }`, {
                input: {
                    id: createProduct.id,
                    translations: [
                        { languageCode: 'en', slug },
                        { languageCode: 'bn', slug },
                    ],
                },
            });
        await rename(`sf-middle-${suffix}`);
        await rename(`sf-new-${suffix}`);
        await expect
            .poll(async () => status(`/product/sf-old-${suffix}/`))
            .toEqual({ status: 301, location: `/product/sf-new-${suffix}/` });
        expect(await status(`/en/product/sf-middle-${suffix}/`)).toEqual({
            status: 301,
            location: `/en/product/sf-new-${suffix}/`,
        });

        await admin.query(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, {
            id: createProduct.id,
        });
        await expect.poll(async () => (await status(`/product/sf-new-${suffix}/`)).status).toBe(410);
        const gone = await page.goto(`${SITE}/product/sf-old-${suffix}/`);
        expect(gone?.status()).toBe(410);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('এই পণ্যটি আর পাওয়া যাচ্ছে না');
        await expect(page.locator('.product-grid .card')).toHaveCount(4);
        expect((await seo(page)).robots).toBe('noindex, follow');

        await admin.query(`mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`, {
            input: {
                enabled: false,
                translations: [
                    { languageCode: 'en', name: 'Hidden', slug: `sf-hidden-${suffix}`, description: '' },
                ],
            },
        });
        expect((await status(`/product/sf-hidden-${suffix}/`)).status).toBe(404);
        expect((await status('/product/sf-never-existed/')).status).toBe(404);
        const missing = await page.goto(`${SITE}/en/no-such-page/`);
        expect(missing?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    });

    test('sitemaps are valid XML in both languages, and robots.txt keeps private pages out', async ({
        page,
    }) => {
        await page.goto(`${SITE}/`);
        const parse = (xml: string) =>
            page.evaluate(text => {
                const doc = new DOMParser().parseFromString(text, 'application/xml');
                return {
                    error: doc.querySelector('parsererror')?.textContent ?? null,
                    locs: [...doc.getElementsByTagName('loc')].map(loc => loc.textContent),
                    alternates: doc.getElementsByTagName('xhtml:link').length,
                    lastmod: doc.getElementsByTagName('lastmod').length,
                };
            }, xml);
        const index = await parse(await (await fetch(`${SITE}/sitemap.xml`)).text());
        expect(index.error).toBeNull();
        expect(index.locs).toEqual([
            `${SITE}/sitemap-products.xml`,
            `${SITE}/sitemap-categories.xml`,
            `${SITE}/sitemap-pages.xml`,
        ]);
        const products = await parse(await (await fetch(`${SITE}/sitemap-products.xml`)).text());
        expect(products.error).toBeNull();
        expect(products.locs).toContain(`${SITE}/product/${enc(fixtures.panjabi.bn)}/`);
        expect(products.locs).toContain(`${SITE}/en/product/${fixtures.panjabi.en}/`);
        expect(products.locs.length).toBeGreaterThanOrEqual(100);
        expect(products.lastmod).toBe(products.locs.length);
        const categories = await parse(await (await fetch(`${SITE}/sitemap-categories.xml`)).text());
        expect(categories.locs).toContain(`${SITE}/en/product-category/sf-men/sf-panjabi/`);
        const pages = await parse(await (await fetch(`${SITE}/sitemap-pages.xml`)).text());
        expect(pages.locs).toContain(`${SITE}/en/${fixtures.page.en}/`);
        expect(pages.locs).toContain(`${SITE}/return-policy/`);

        const robots = await (await fetch(`${SITE}/robots.txt`)).text();
        for (const line of [
            'Disallow: /cart/',
            'Disallow: /en/checkout/',
            'Disallow: /search/',
            'Disallow: /*?*filter.',
            'Disallow: /*?*sort=',
            `Sitemap: ${SITE}/sitemap.xml`,
        ]) {
            expect(robots).toContain(line);
        }
    });

    test('search, cart and checkout are never indexed or cached', async ({ page }) => {
        await page.goto(`${SITE}/search/?q=${encodeURIComponent('পাঞ্জাবি')}`);
        expect((await seo(page)).robots).toBe('noindex, follow');
        for (const path of ['/search/?q=x', '/cart/', '/en/checkout/', '/account/', '/track/']) {
            const response = await fetch(`${SITE}${path}`);
            expect(response.status, path).toBe(200);
            expect(response.headers.get('cache-control'), path).toBe('no-store');
            expect(response.headers.get('x-robots-tag'), path).toBe('noindex');
        }
    });

    test('security headers, and the floating contact buttons are plain links', async ({ page }) => {
        const response = await fetch(`${SITE}/`);
        const csp = response.headers.get('content-security-policy') ?? '';
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toContain('unsafe-inline');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
        expect(response.headers.get('permissions-policy')).toContain('camera=()');

        const errors: string[] = [];
        page.on('console', message => message.type() === 'error' && errors.push(message.text()));
        await page.goto(`${SITE}/`);
        await expect(page.locator('.floating-contact a.float-whatsapp')).toHaveAttribute(
            'href',
            /^https:\/\/wa\.me\/880\d{10}$/,
        );
        // Scripts only as files from our own origin (no inline script, no third party).
        const sources = await page
            .locator('script[src]')
            .evaluateAll(scripts => scripts.map(s => s.getAttribute('src')));
        expect(sources.every(src => src?.startsWith('/_astro/'))).toBe(true);
        expect(errors).toEqual([]);
    });

    test('no sideways scrolling at phone width', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Phone layout');
        for (const path of [
            '/',
            `/product/${enc(fixtures.panjabi.bn)}/`,
            `/product-category/${enc(fixtures.men.bn)}/`,
        ]) {
            await page.goto(`${SITE}${path}`);
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth > window.innerWidth,
            );
            expect(overflow, path).toBe(false);
        }
    });
});

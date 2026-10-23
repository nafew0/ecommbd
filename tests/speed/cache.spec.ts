import { expect, type APIResponse, test } from '@playwright/test';
import fs from 'node:fs';
import { createSalesPage, ensureSalesProducts, publishSalesPage } from '../browser/support/sales';
import {
    adminSession,
    type ApiSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from '../browser/support/store-api';
import { ensureStorefrontFixtures, type StorefrontFixtures } from '../browser/support/storefront-seed';

/**
 * The storefront cache against the real stack (roadmap phase 17): Varnish, the built storefront,
 * the core and its worker, started by scripts/speed-check.mjs (`npm run test:speed`). Run on
 * their own, these tests need the same environment variables the script sets.
 *
 * `x-cache` says HIT, MISS or PASS (passed to the storefront, never stored). `x-varnish` names the
 * cached object a HIT came from (its second number), which shows whether a page was purged.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:6081';
const PURGE = process.env.CACHE_PURGE_URL ?? 'http://127.0.0.1:6082/';
const TOKEN = process.env.CACHE_PURGE_SECRET ?? '';
const STORE = process.env.CACHE_STORE_ID ?? 'store17';

let admin: ApiSession;
let fixtures: StorefrontFixtures;
let productId: string;
let salesUrl: string;
let originalName: string;

const product = () => `${SITE}/en/product/${fixtures.panjabi.en}/`;
const category = () => `${SITE}/en/product-category/${fixtures.men.en}/${fixtures.menPanjabi.en}/`;
const contentPage = () => `${SITE}/en/${fixtures.page.en}/`;

/** The cached object a response came from (a MISS is the request that stored it). */
function objectOf(response: APIResponse): string {
    const ids = (response.headers()['x-varnish'] ?? '').split(' ');
    return ids[1] ?? ids[0] ?? '';
}

test.beforeAll(async () => {
    if (!TOKEN) throw new Error('Set CACHE_PURGE_SECRET (npm run test:speed does)');
    admin = await adminSession();
    fixtures = await ensureStorefrontFixtures(admin);
    const {
        bdStoreSettings: { settings },
    } = await admin.query('{ bdStoreSettings { settings } }');
    if (!settings.profile.storeName.en && !settings.profile.storeName.bn) {
        settings.profile.storeName = { en: 'Speed fixture', bn: 'গতির দোকান' };
        await admin.query('mutation($input:JSON!){ updateBdStoreSettings(input:$input){errors{path}} }', {
            input: settings,
        });
    }
    const { products } = await admin.query(
        'query($slug:String!){products(options:{filter:{slug:{eq:$slug}}}){items{id translations{languageCode name}}}}',
        { slug: fixtures.panjabi.en },
    );
    productId = products.items[0].id;
    originalName = products.items[0].translations.find(
        (t: { languageCode: string }) => t.languageCode === 'en',
    ).name;
    const source = await ensureSalesProducts(admin);
    const sales = await createSalesPage(admin, {
        title: 'Speed fixture honey',
        slug: 'speed-honey-' + Date.now(),
        template: 'ghee-honey',
        productId: source.honey.productId,
    });
    await publishSalesPage(admin, sales);
    salesUrl = `${SITE}/en/s/${sales.slug}/`;
    await ensureCheckoutFixtures(admin);
    fs.mkdirSync('.performance', { recursive: true });
    fs.writeFileSync(
        '.performance/urls.json',
        JSON.stringify({ product: product(), sales: salesUrl, checkout: `${SITE}/en/checkout/` }),
    );
    // Let the fixtures' own purges (and the listing follow-ups) go out before measuring.
    await new Promise(resolve => setTimeout(resolve, 8000));
});

test.afterAll(async () => {
    if (productId && originalName)
        await admin.query('mutation($input:UpdateProductInput!){updateProduct(input:$input){id}}', {
            input: { id: productId, translations: [{ languageCode: 'en', name: originalName }] },
        });
});

test('a public page is stored once; tracking and unknown parameters reuse it, listing ones don’t', async ({
    request,
}) => {
    await request.get(product());
    const hit = await request.get(product());
    expect(hit.headers()['x-cache']).toBe('HIT');
    expect(hit.headers()['set-cookie']).toBeUndefined();
    for (const extra of [
        '?utm_source=fb&utm_campaign=one&fbclid=abc',
        '?x=' + Date.now(),
        '?gclid=1&ref=2',
    ]) {
        const response = await request.get(product() + extra);
        expect(response.headers()['x-cache'], extra).toBe('HIT');
        expect(objectOf(response), extra).toBe(objectOf(hit));
    }
    // The category reads its sort and filters: each value is its own page…
    const byPrice = category() + '?sort=price-asc';
    await request.get(byPrice);
    const priceHit = await request.get(byPrice + '&x=' + Date.now());
    expect(priceHit.headers()['x-cache']).toBe('HIT');
    const newest = await request.get(category() + '?sort=newest');
    expect(objectOf(newest)).not.toBe(objectOf(priceHit));
    // …and parameter order doesn't matter.
    await request.get(category() + '?filter.stock=in&sort=price-asc');
    const sorted = await request.get(category() + '?sort=price-asc&filter.stock=in');
    expect(sorted.headers()['x-cache']).toBe('HIT');
});

test('purges: refused on the public port, need the secret, and only the purge port names the start', async ({
    request,
}) => {
    const purge = (url: string, headers: Record<string, string>) =>
        request.fetch(url, { method: 'PURGE', headers });
    expect(
        (await purge(SITE + '/', { 'X-Purge-Token': TOKEN, 'X-Purge-Tags': `${STORE}:none` })).status(),
    ).toBe(403);
    expect((await purge(PURGE, { 'X-Purge-Tags': `${STORE}:none` })).status()).toBe(403);
    expect((await purge(PURGE, { 'X-Purge-Token': TOKEN, 'X-Purge-Tags': `${STORE}:none` })).status()).toBe(
        200,
    );
    const status = await request.get(PURGE, { headers: { 'X-Purge-Token': TOKEN } });
    expect(status.headers()['x-cache-instance']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request.get(PURGE)).headers()['x-cache-instance']).toBeUndefined();
    expect((await request.get(product())).headers()['x-cache-instance']).toBeUndefined();
});

test('redirects keep each visitor’s own tracking, which never reaches a shared page', async ({ request }) => {
    const old = product().replace('/product/', '/PRODUCT/');
    expect((await request.get(old, { maxRedirects: 0 })).status()).toBe(301);
    for (const id of ['visitor-one-17', 'visitor-two-17']) {
        const moved = await request.get(old + '?utm_source=ads&fbclid=' + id, { maxRedirects: 0 });
        expect(moved.status()).toBe(301);
        expect(moved.headers().location).toContain('fbclid=' + id);
        expect(moved.headers().location).not.toContain(
            id === 'visitor-one-17' ? 'visitor-two-17' : 'visitor-one-17',
        );
    }
    const shared = await request.get(product() + '?fbclid=visitor-private-click-17');
    expect(await shared.text()).not.toContain('visitor-private-click-17');
});

test('a product edit refreshes its page and category within 3 seconds, and leaves content pages alone', async ({
    request,
}) => {
    for (const url of [product(), category(), contentPage()]) await request.get(url);
    const content = await request.get(contentPage());
    expect(content.headers()['x-cache']).toBe('HIT');
    const name = 'Fresh cached panjabi ' + Date.now();
    const started = Date.now();
    await admin.query('mutation($input:UpdateProductInput!){updateProduct(input:$input){id}}', {
        input: { id: productId, translations: [{ languageCode: 'en', name }] },
    });
    await expect
        .poll(
            async () =>
                (await (await request.get(product())).text()).includes(name) &&
                (await (await request.get(category())).text()).includes(name),
            { timeout: 3000, intervals: [50, 100, 150] },
        )
        .toBe(true);
    const ms = Date.now() - started;
    console.log('Product and category showed the edit after (ms):', ms);
    expect(ms).toBeLessThanOrEqual(3000);
    // After the purge and the listing follow-up (CACHE_LISTING_SETTLE_MS plus the search cache):
    // the content page is the same stored object. A soft purge would serve it once more, then
    // replace it, so two requests a moment apart would show a new object.
    await new Promise(resolve => setTimeout(resolve, 9000));
    for (let i = 0; i < 2; i++) {
        const again = await request.get(contentPage());
        expect(again.headers()['x-cache']).toBe('HIT');
        expect(objectOf(again)).toBe(objectOf(content));
        await new Promise(resolve => setTimeout(resolve, 500));
    }
});

test('an order that leaves a product low on stock refreshes its page', async ({ request }) => {
    const variantId = await ensureCheckoutFixtures(admin);
    const page = `${SITE}/en/product/playwright-panjabi/`;
    await admin.query(
        'mutation($input:[UpdateProductVariantInput!]!){updateProductVariants(input:$input){id}}',
        {
            input: [{ id: variantId, stockOnHand: 3 }],
        },
    );
    try {
        await expect
            .poll(async () => (await (await request.get(page)).text()).includes('Only a few left'))
            .toBe(false);
        await request.get(page);
        expect((await request.get(page)).headers()['x-cache']).toBe('HIT');
        // Three left, one ordered: two is "only a few left" (Vendure's low-stock level).
        await placePhoneOrder({ variantId, name: 'Speed shopper', phone: randomPhone() });
        await expect
            .poll(async () => (await (await request.get(page)).text()).includes('Only a few left'), {
                timeout: 5000,
                intervals: [100, 200, 300],
            })
            .toBe(true);
    } finally {
        await admin.query(
            'mutation($input:[UpdateProductVariantInput!]!){updateProductVariants(input:$input){id}}',
            {
                input: [{ id: variantId, stockOnHand: 1_000_000 }],
            },
        );
    }
});

test('personal routes, sessions and previews are never stored, however often they are asked for', async ({
    request,
}) => {
    const salesPath = new URL(salesUrl).pathname;
    for (const path of [
        '/en/cart/',
        '/en/checkout/',
        '/en/account/',
        '/en/account/x.css',
        '/en/track/',
        '/t/opaque/',
        salesPath + 'order/',
        salesPath + 'thank-you/',
        '/?preview=invalid',
        '/en/search/?q=panjabi',
    ]) {
        for (let i = 0; i < 2; i++) {
            const response = await request.get(SITE + path, { maxRedirects: 0 });
            expect(response.headers()['x-cache'], path).toBe('PASS');
            expect(response.headers()['cache-control'], path).toContain('no-store');
        }
    }
    for (const headers of [{ cookie: 'shop-session=private' }, { authorization: 'Bearer private' }]) {
        for (let i = 0; i < 2; i++)
            expect((await request.get(product(), { headers })).headers()['x-cache']).toBe('PASS');
    }
    // Other cookies (analytics) are dropped on public pages: still the shared copy.
    const anonymous = await request.get(product(), {
        headers: { cookie: '_ga=tracking; arbitrary=ignored' },
    });
    expect(anonymous.headers()['x-cache']).toBe('HIT');
});

test('two shoppers’ carts, checkouts and accounts stay their own through Varnish', async ({ browser }) => {
    const contexts = await Promise.all([
        browser.newContext({ javaScriptEnabled: false }),
        browser.newContext({ javaScriptEnabled: false }),
    ]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (let i = 0; i < 2; i++) {
        await pages[i]!.goto(product());
        await pages[i]!.locator('input[name="quantity"]')
            .first()
            .fill(String(i + 1));
        await pages[i]!.getByRole('button', { name: 'Add to cart', exact: true }).click();
        await expect(pages[i]!).toHaveURL(/\/cart\//);
    }
    for (let i = 0; i < 2; i++) {
        const quantity = String(i + 1);
        const cart = await pages[i]!.reload();
        expect(cart?.headers()['cache-control']).toContain('no-store');
        expect(cart?.headers()['x-cache']).toBe('PASS');
        await expect(pages[i]!.locator('.quantity-value').first()).toHaveText(quantity);
        const checkout = await pages[i]!.goto(SITE + '/en/checkout/');
        expect(checkout?.headers()['cache-control']).toContain('no-store');
        expect(checkout?.headers()['x-cache']).toBe('PASS');
        await expect(pages[i]!.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
        await expect(pages[i]!.locator('.summary-quantity').first()).toHaveText(quantity);
        const account = await pages[i]!.goto(SITE + '/en/account/');
        expect(account?.headers()['cache-control']).toContain('no-store');
        expect(account?.headers()['x-cache']).toBe('PASS');
    }
    await Promise.all(contexts.map(context => context.close()));
});

test('HEAD and conditional requests are answered from the cache', async ({ request }) => {
    await request.get(product());
    const head = await request.head(product());
    expect(head.status()).toBe(200);
    expect((await head.body()).length).toBe(0);
    const conditional = await request.get(product(), {
        headers: { 'if-modified-since': new Date(0).toUTCString() },
    });
    expect(conditional.status()).toBe(200);
});

/** Every `<loc>` in one of the store's sitemaps. */
async function sitemap(request: { get(url: string): Promise<APIResponse> }, name: string): Promise<string[]> {
    const xml = await (await request.get(`${SITE}/${name}`)).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]!.replace(/&amp;/g, '&'));
}

test('a crawl of the store: the second pass is served from the cache', async ({ request }) => {
    // Over a hundred pages, each rendered once on the first pass.
    test.setTimeout(240_000);
    const urls = [
        ...new Set([
            `${SITE}/`,
            `${SITE}/en/`,
            ...(await sitemap(request, 'sitemap-products.xml')),
            ...(await sitemap(request, 'sitemap-categories.xml')),
            ...(await sitemap(request, 'sitemap-pages.xml')),
            salesUrl,
        ]),
    ];
    const kinds = {
        products: urls.filter(url => url.includes('/product/')).length,
        categories: urls.filter(url => url.includes('/product-category/')).length,
    };
    expect(kinds.products).toBeGreaterThan(20);
    expect(kinds.categories).toBeGreaterThan(1);
    // First pass: fills the cache (pages the warm-up or earlier tests fetched are there already).
    let alreadyCached = 0;
    for (const url of urls) {
        const response = await request.get(url);
        expect(response.status(), url).toBe(200);
        if (response.headers()['x-cache'] === 'HIT') alreadyCached++;
    }
    // Second pass: what a shopper gets.
    let hits = 0;
    for (const url of urls) if ((await request.get(url)).headers()['x-cache'] === 'HIT') hits++;
    const ratio = hits / urls.length;
    console.log(
        `Crawl: ${urls.length} distinct pages (${kinds.products} product, ${kinds.categories} category). ` +
            `First pass ${alreadyCached} already cached; second pass ${hits} hits (${(ratio * 100).toFixed(1)}%)`,
    );
    expect(ratio).toBeGreaterThan(0.9);
});

test('the speed beacon: a sampled visit’s browser sends anonymous measurements that are stored', async ({
    page,
}) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const stored = async () => {
        const rows: Array<{ day: string; route: string; samples: number }> = (
            await admin.query('{cacheDailyVitals}')
        ).cacheDailyVitals;
        return rows
            .filter(row => String(row.day).startsWith(today) && row.route === 'product')
            .reduce((sum, row) => sum + row.samples, 0);
    };
    const before = await stored();
    const sent: string[] = [];
    const scripts: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path === '/cache-metrics') sent.push(request.postData() ?? '');
        if (request.resourceType() === 'script') scripts.push(path);
    });
    await page.goto(product(), { waitUntil: 'networkidle' });
    // VITALS_SAMPLE_RATE is 1 in the speed run: this visit is sampled, so web-vitals loads.
    expect(scripts.some(path => /\/web-vitals\.[\w-]+\.js$/.test(path))).toBe(true);
    // Leaving the page hides it: web-vitals then reports LCP and CLS with sendBeacon, which the
    // browser delivers even as the page goes away.
    await page.waitForTimeout(500);
    await page.goto(contentPage());
    await expect.poll(stored, { timeout: 10_000 }).toBeGreaterThan(before);
    // What the beacons carried, when the browser shows them to the test: four fields, no address.
    for (const body of sent.filter(Boolean)) {
        const sample = JSON.parse(body) as Record<string, unknown>;
        expect(Object.keys(sample).sort()).toEqual(['metricId', 'name', 'route', 'value']);
    }
});

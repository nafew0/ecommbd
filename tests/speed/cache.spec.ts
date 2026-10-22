import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { adminSession, type ApiSession } from '../browser/support/store-api';
import { ensureStorefrontFixtures, type StorefrontFixtures } from '../browser/support/storefront-seed';
import { createSalesPage, ensureSalesProducts, publishSalesPage } from '../browser/support/sales';

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:6085';
const PURGE = process.env.CACHE_PURGE_URL ?? 'http://localhost:6086/';
const TOKEN = process.env.CACHE_PURGE_SECRET ?? '0'.repeat(64);
let admin: ApiSession, fixtures: StorefrontFixtures, productId: string, salesSlug: string;
let originalName: string;
const product = () => `${SITE}/en/product/${fixtures.panjabi.en}/`;
test.beforeAll(async () => {
    admin = await adminSession();
    fixtures = await ensureStorefrontFixtures(admin);
    const {
        bdStoreSettings: { settings: bdStoreSettings },
    } = await admin.query('{ bdStoreSettings { settings } }');
    if (!bdStoreSettings.profile.storeName.en && !bdStoreSettings.profile.storeName.bn) {
        bdStoreSettings.profile.storeName = { en: 'Speed fixture', bn: 'গতির দোকান' };
        await admin.query('mutation($input:JSON!){ updateBdStoreSettings(input:$input){errors{path}} }', {
            input: bdStoreSettings,
        });
    }
    const { products } = await admin.query(
        'query($slug:String!){products(options:{filter:{slug:{eq:$slug}}}){items{id translations{languageCode name} variants{id}}}}',
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
    salesSlug = sales.slug;
    fs.mkdirSync('.performance', { recursive: true });
    fs.writeFileSync(
        '.performance/urls.json',
        JSON.stringify({
            product: product(),
            sales: `${SITE}/en/s/${sales.slug}/`,
            checkout: `${SITE}/en/checkout/`,
        }),
    );
    await new Promise(r => setTimeout(r, 3000));
});
test.afterAll(async () => {
    if (productId && originalName)
        await admin.query('mutation($input:UpdateProductInput!){updateProduct(input:$input){id}}', {
            input: { id: productId, translations: [{ languageCode: 'en', name: originalName }] },
        });
});
test('public HTML has MISS then HIT; tracking queries share the object and filters stay distinct', async ({
    request,
}) => {
    const path = product() + '?speed=cache-key';
    await request.get(path);
    const hit = await request.get(path);
    expect(hit.headers()['x-cache']).toBe('HIT');
    expect(hit.headers()['set-cookie']).toBeUndefined();
    const tracking = await request.get(path + '&utm_source=fb&utm_campaign=one&fbclid=abc');
    expect(tracking.headers()['x-varnish']?.split(' ')[1]).toBe(hit.headers()['x-varnish']?.split(' ')[1]);
    const functional = await request.get(product() + '?speed=different');
    expect(functional.headers()['x-cache']).toBe('MISS');
    const sorted = await request.get(product() + '?b=2&a=1');
    const sortedHit = await request.get(product() + '?a=1&b=2');
    expect(sortedHit.headers()['x-cache']).toBe('HIT');
    expect(await sortedHit.text()).toBe(await sorted.text());
});
test('public purge is refused; the loopback control port requires its secret', async ({ request }) => {
    expect(
        (
            await request.fetch(SITE + '/', {
                method: 'PURGE',
                headers: { 'X-Purge-Token': TOKEN, 'X-Purge-Tags': 'store17:store' },
            })
        ).status(),
    ).toBe(403);
    expect(
        (
            await request.fetch(PURGE, { method: 'PURGE', headers: { 'X-Purge-Tags': 'store17:store' } })
        ).status(),
    ).toBe(403);
    expect(
        (
            await request.fetch(PURGE, {
                method: 'PURGE',
                headers: { 'X-Purge-Token': TOKEN, 'X-Purge-Tags': 'store17:store' },
            })
        ).status(),
    ).toBe(200);
});
test('redirects preserve each visitor’s tracking without sharing it across visitors', async ({ request }) => {
    const old = product().replace('/product/', '/PRODUCT/');
    expect((await request.get(old, { maxRedirects: 0 })).status()).toBe(301);
    for (const id of ['visitor-one-17', 'visitor-two-17']) {
        const moved = await request.get(old + '?utm_source=ads&fbclid=' + id, { maxRedirects: 0 });
        expect(moved.status()).toBe(301);
        expect(moved.headers().location).toContain(id);
    }
    const shared = await request.get(product() + '?fbclid=visitor-private-click-17');
    expect(await shared.text()).not.toContain('visitor-private-click-17');
});
test('a product edit refreshes product and category pages within three seconds', async ({ request }) => {
    const category = `${SITE}/en/product-category/${fixtures.men.en}/${fixtures.menPanjabi.en}/`;
    await request.get(product());
    await request.get(category);
    const name = 'Fresh cached panjabi ' + Date.now();
    const started = Date.now();
    await admin.query('mutation($input:UpdateProductInput!){updateProduct(input:$input){id}}', {
        input: { id: productId, translations: [{ languageCode: 'en', name }] },
    });
    await expect
        .poll(
            async () =>
                (await (await request.get(product())).text()).includes(name) &&
                (await (await request.get(category)).text()).includes(name),
            { timeout: 3000, intervals: [50, 100, 150] },
        )
        .toBe(true);
    const ms = Date.now() - started;
    console.log('Product/category freshness milliseconds:', ms);
    expect(ms).toBeLessThanOrEqual(3000);
});
test('cache keys isolate Host and language; forwarding headers cannot poison a page', async ({ request }) => {
    const first = await request.get(product() + '?host-test=1');
    const other = await request.get(product() + '?host-test=1', { headers: { Host: 'other.fixture.test' } });
    expect(other.headers()['x-cache']).toBe('MISS');
    const poisoned = await request.get(product() + '?host-test=1', {
        headers: {
            'x-forwarded-host': 'evil.example',
            forwarded: 'host=evil.example',
            'x-original-url': '/cart/',
        },
    });
    expect(await poisoned.text()).toBe(await first.text());
    const bangla = await request.get(`${SITE}/product/${encodeURIComponent(fixtures.panjabi.bn)}/`);
    expect(await bangla.text()).toContain('lang="bn"');
    expect(await first.text()).toContain('lang="en"');
    const spelling = `${SITE}/product/${encodeURIComponent(fixtures.panjabi.bn).replace(/%[0-9A-F]{2}/g, part => part.toLowerCase())}/`;
    const normalized = await request.get(spelling, { maxRedirects: 0 });
    if (normalized.status() === 301) {
        const final = await request.get(new URL(normalized.headers().location, SITE).href, {
            maxRedirects: 0,
        });
        expect(final.status()).toBe(200);
        expect(final.headers()['x-cache']).toBe('HIT');
    } else {
        expect(normalized.status()).toBe(200);
        expect(normalized.headers()['x-cache']).toBe('HIT');
    }
});
test('authorization, session cookies, private prefixes and previews never hit the cache', async ({
    request,
}) => {
    for (const path of [
        '/en/cart/',
        '/en/checkout/',
        '/en/account/x.css',
        '/en/track/',
        '/t/opaque/',
        '/en/s/' + salesSlug + '/order/',
        '/en/s/' + salesSlug + '/thank-you/',
        '/?preview=invalid',
    ]) {
        const response = await request.get(SITE + path);
        expect(response.headers()['cache-control']).toContain('no-store');
        expect(response.headers()['x-cache']).not.toBe('HIT');
    }
    for (const headers of [{ cookie: 'shop-session=private' }, { authorization: 'Bearer private' }]) {
        const response = await request.get(product(), { headers });
        expect(response.headers()['x-cache']).not.toBe('HIT');
    }
    const anonymous = await request.get(product(), {
        headers: { cookie: '_ga=tracking; arbitrary=ignored' },
    });
    expect(anonymous.headers()['x-cache']).toBe('HIT');
});
test('two independent shopper carts stay private through Varnish', async ({ browser }) => {
    const contexts = await Promise.all([
        browser.newContext({ javaScriptEnabled: false }),
        browser.newContext({ javaScriptEnabled: false }),
    ]);
    const pages = await Promise.all(contexts.map(c => c.newPage()));
    for (let i = 0; i < 2; i++) {
        await pages[i].goto(product());
        await pages[i]
            .locator('input[name="quantity"]')
            .first()
            .fill(String(i + 1));
        await pages[i].getByRole('button', { name: 'Add to cart', exact: true }).click();
        await expect(pages[i]).toHaveURL(/\/cart\//);
    }
    for (let i = 0; i < 2; i++) {
        const response = await pages[i].reload();
        expect(response?.headers()['cache-control']).toContain('no-store');
        await expect(pages[i].locator('.quantity-value').first()).toHaveText(String(i + 1));
        await pages[i].goto(SITE + '/en/checkout/');
        await expect(pages[i].getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    }
    await Promise.all(contexts.map(c => c.close()));
});
test('HEAD and conditional requests are safe and a warm crawl exceeds 90% hits', async ({ request }) => {
    await request.get(product());
    const head = await request.head(product());
    expect(head.status()).toBe(200);
    expect((await head.body()).length).toBe(0);
    expect(
        (
            await request.get(product(), { headers: { 'if-modified-since': new Date(0).toUTCString() } })
        ).status(),
    ).toBe(200);
    let hits = 0;
    for (let i = 0; i < 50; i++)
        if ((await request.get(product() + '?utm_source=hit' + i)).headers()['x-cache'] === 'HIT') hits++;
    console.log('Warm crawl hit ratio:', hits / 50);
    expect(hits / 50).toBeGreaterThan(0.9);
});
test('sampled web-vitals beacon stores only allowed fields', async ({ page, request }) => {
    await page.goto(product());
    await page
        .getByRole('link', { name: 'Cart', exact: true })
        .first()
        .click()
        .catch(() => {});
    const response = await request.post(SITE + '/cache-metrics', {
        headers: { origin: SITE },
        data: { metricId: 'speed-browser-17', name: 'LCP', value: 321, route: 'product' },
    });
    expect(response.status()).toBe(204);
    expect(
        (
            await request.post(SITE + '/cache-metrics', {
                headers: { origin: SITE },
                data: {
                    metricId: 'speed-browser-17-private',
                    name: 'LCP',
                    value: 321,
                    route: 'product',
                    phone: 'private',
                },
            })
        ).status(),
    ).toBe(400);
    expect((await admin.query('{cacheDailyVitals}')).cacheDailyVitals).toBeInstanceOf(Array);
});

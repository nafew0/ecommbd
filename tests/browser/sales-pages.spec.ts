import { createSection, LANDING_TEMPLATES } from '@ecommbd/sections';
import { ATTRIBUTION_COOKIE } from '@ecommbd/shared';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { signIn, watchForErrors } from './support/admin-ui';
import {
    createSalesPage,
    deleteSalesPage,
    ensureSalesProducts,
    orderByCode,
    publishSalesPage,
    type SalesProducts,
    setSaleableStock,
    type TestSalesPage,
    updateSalesSettings,
} from './support/sales';
import { waitForStorefront } from './support/sections';
import { adminSession, type ApiSession, ensureCheckoutFixtures, randomPhone } from './support/store-api';

/**
 * Sales pages (roadmap phase 16): a merchant makes one from a template and a product in the admin
 * and publishes it; a shopper orders a pack with and without the add-on (with and without
 * JavaScript) and reaches the thank-you page; the order records the ad it came from (last
 * non-direct visit); stock limits packs and hides the add-on; every template stays within the
 * sales page budget. English pages are under /en/ (the storefront's default language is Bangla).
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const DHAKA = 'BD3026';
const MIRPUR = 'BD3026M26';

let admin: ApiSession;
let products: SalesProducts;
let salesPage: TestSalesPage;
let paymentSettings: Record<string, unknown>;
let fraudSettings: Record<string, unknown>;
const created: string[] = [];

const unique = () => Math.random().toString(36).slice(2, 8);
const pageUrl = (slug: string, query = '') => `${SITE}/en/s/${encodeURIComponent(slug)}/${query}`;

async function setStore() {
    ({ bdPaymentSettings: paymentSettings } = await admin.query('{ bdPaymentSettings }'));
    ({ bdFraudSettings: fraudSettings } = await admin.query('{ bdFraudSettings }'));
    // Cash on delivery, no advance and no SMS code: the checkout tests cover those.
    await admin.query(
        'mutation ($input: JSON!) { updateBdPaymentSettings(input: $input) { errors { path } } }',
        {
            input: {
                ...paymentSettings,
                cod: { enabled: true, maxOrderTotal: null, zones: [] },
                advance: { ...(paymentSettings.advance as object), enabled: false },
            },
        },
    );
    await admin.query(
        'mutation ($input: JSON!) { updateBdFraudSettings(input: $input) { errors { path } } }',
        {
            input: { ...fraudSettings, otp: { ...(fraudSettings.otp as object), mode: 'off' } },
        },
    );
}

/** Fills the order form in English. Without JavaScript, "Show thanas" and "Update total" re-render. */
async function fillOrder(page: Page, phone: string, { script = true } = {}) {
    const started = Date.now();
    await page.getByLabel('Your name').fill('PW Sales Shopper');
    await page.getByLabel('Mobile number', { exact: true }).fill(phone);
    await page.getByLabel('District').selectOption(DHAKA);
    if (!script) await page.getByRole('button', { name: 'Show thanas' }).click();
    await expect(page.getByLabel('Thana / upazila').locator(`option[value="${MIRPUR}"]`)).toHaveCount(1);
    await page.getByLabel('Thana / upazila').selectOption(MIRPUR);
    await page.getByLabel('Full address').fill('House 12, Road 5, Mirpur 10');
    if (!script) await page.getByRole('button', { name: 'Update total' }).click();
    await expect(page.locator('[data-part="summary"]')).toContainText('৳60');
    // Forms sent within 3 seconds look like a bot to the core (phase 11).
    await page.waitForTimeout(Math.max(0, 3200 - (Date.now() - started)));
}

async function placeOrder(page: Page): Promise<string> {
    await page.getByRole('button', { name: /^Confirm order/ }).click();
    await expect(page).toHaveURL(/\/s\/[^/]+\/thank-you\/\?order=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you! Your order is placed.');
    return new URL(page.url()).searchParams.get('order')!;
}

async function attributionCookie(context: BrowserContext) {
    const cookie = (await context.cookies(SITE)).find(item => item.name === ATTRIBUTION_COOKIE);
    return cookie ? JSON.parse(decodeURIComponent(cookie.value)) : null;
}

test.describe('sales pages', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        test.setTimeout(120_000);
        admin = await adminSession();
        await ensureCheckoutFixtures(admin);
        products = await ensureSalesProducts(admin);
        await setSaleableStock(admin, products.honey.variantId, 500);
        await setSaleableStock(admin, products.spoon.variantId, 500);
        await setStore();
        // One page for the shopper tests: packs suggested from the price, the spoon as the add-on.
        const page = await createSalesPage(admin, {
            title: `PW honey offer ${unique()}`,
            template: 'ghee-honey',
            productId: products.honey.productId,
        });
        created.push(page.id);
        salesPage = await updateSalesSettings(admin, page, settings => ({
            ...settings,
            bump: {
                enabled: true,
                variantId: products.spoon.variantId,
                price: 12_000,
                title: { bn: 'একটি কাঠের চামচ', en: 'A wooden spoon' },
                text: { bn: '', en: '' },
            },
        }));
        // A Custom section with its own design, to check the generated styles under the CSP.
        const draft = await publishSalesPage(admin, salesPage);
        const custom = createSection('custom');
        custom.style.design = { ...custom.style.design, background: '#0b3d2e', text: '#ffffff', radius: 8 };
        await publishSalesPage(admin, salesPage, { sections: [...draft.sections, custom] });
        await waitForStorefront(pageUrl(salesPage.slug), html => html.includes('section-custom'));
    });

    test.afterAll(async () => {
        for (const id of created) await deleteSalesPage(admin, id).catch(() => undefined);
        await setSaleableStock(admin, products.honey.variantId, 500);
        await setSaleableStock(admin, products.spoon.variantId, 500);
        await admin.query(
            'mutation ($input: JSON!) { updateBdPaymentSettings(input: $input) { errors { path } } }',
            {
                input: paymentSettings,
            },
        );
        await admin.query(
            'mutation ($input: JSON!) { updateBdFraudSettings(input: $input) { errors { path } } }',
            {
                input: fraudSettings,
            },
        );
    });

    test('a merchant makes a sales page from a template and a product, edits the hero and publishes it', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The admin flow on a computer; phones get the shopper tests');
        test.setTimeout(90_000);
        const errors = watchForErrors(page);
        const started = Date.now();
        await signIn(page, 'en');
        await page.goto('/admin/sales-pages');
        await page.getByRole('button', { name: 'New sales page' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'New sales page' });
        const title = `PW chia seeds ${unique()}`;
        await dialog.getByLabel('Page name').fill(title);
        await expect(dialog.getByLabel('Address')).toHaveValue(title.toLowerCase().replace(/ /g, '-'));
        await dialog.getByRole('button', { name: 'Choose a product' }).click();
        const picker = page.getByRole('dialog', { name: 'Choose a product' });
        await picker.getByPlaceholder('Search products by name').fill('Sales test honey');
        await picker
            .getByRole('button', { name: /Sales test honey/ })
            .first()
            .click();
        await dialog.getByRole('tab', { name: 'Health and herbal' }).click();
        await dialog.getByRole('button', { name: /Herbal product/ }).click();
        await dialog.getByRole('button', { name: 'Create and edit' }).click();

        await expect(page).toHaveURL(/\/admin\/store\/design\/landing\/[\w-]+$/);
        created.push(page.url().split('/').pop()!);
        const preview = page.frameLocator('iframe[title="Preview of the page"]');
        await expect(preview.locator('body[data-preview="editor"]')).toBeAttached({ timeout: 15_000 });
        // The template took the product's name.
        await expect(preview.locator('.sales-headline')).toContainText('Sales test honey');
        await page
            .getByRole('button', { name: /^Sales hero/ })
            .first()
            .click();
        const headline = `Pure honey from the Sundarbans ${unique()}`;
        await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(headline);
        await expect(preview.locator('.sales-headline')).toContainText(headline, { timeout: 10_000 });
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Published. The live page updates within seconds.')).toBeVisible();
        console.log(`Made and published a sales page in ${Math.round((Date.now() - started) / 1000)} s`);

        const slug = title.toLowerCase().replace(/ /g, '-');
        await waitForStorefront(pageUrl(slug), html => html.includes(headline));
        await page.goto('/admin/sales-pages');
        await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText('Live');
        expect(errors).toEqual([]);
    });

    test('a shopper orders a pack with the add-on from an ad, then a pack without it', async ({ page }) => {
        test.setTimeout(90_000);
        const errors = watchForErrors(page);
        const pack = (quantity: number) => salesPage.settings.packs.find(item => item.quantity === quantity)!;
        await page.goto(
            pageUrl(
                salesPage.slug,
                '?utm_source=facebook&utm_medium=paid&utm_campaign=pw-eid&fbclid=PWfb123',
            ),
        );
        // Hidden from search engines by default; the Design options' styles are allowed by the CSP.
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.locator('.section-custom')).toHaveCSS('background-color', 'rgb(11, 61, 46)');

        await page.locator('#order').scrollIntoViewIfNeeded();
        await page.locator('input[data-pack][value="2"]').check();
        await page.locator('[data-bump]').check();
        await fillOrder(page, randomPhone());
        const withBump = pack(2).price + 12_000 + 6_000;
        await expect(page.getByRole('button', { name: /^Confirm order/ })).toContainText(
            `৳${(withBump / 100).toLocaleString('en-US')}`,
        );
        const code = await placeOrder(page);
        const order = await orderByCode(admin, code);
        expect(order.totalWithTax).toBe(withBump);
        expect(order.lines).toEqual(
            expect.arrayContaining([
                { quantity: 2, productVariant: { id: products.honey.variantId } },
                { quantity: 1, productVariant: { id: products.spoon.variantId } },
            ]),
        );
        expect(order.bdAttribution).toMatchObject({
            salesPage: { id: salesPage.id },
            source: 'facebook',
            medium: 'paid',
            campaign: 'pw-eid',
            fbclid: 'PWfb123',
        });

        // The same shopper comes back for a single one, without the add-on.
        await page.goto(pageUrl(salesPage.slug));
        await page.locator('input[data-pack][value="1"]').check();
        await fillOrder(page, randomPhone());
        const second = await orderByCode(admin, await placeOrder(page));
        expect(second.totalWithTax).toBe(pack(1).price + 6_000);
        expect(second.lines).toEqual([{ quantity: 1, productVariant: { id: products.honey.variantId } }]);
        // Still the ad: a direct visit doesn't replace it.
        expect(second.bdAttribution.campaign).toBe('pw-eid');
        expect(errors).toEqual([]);
    });

    test('the order form works without JavaScript', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Once is enough');
        test.setTimeout(60_000);
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(pageUrl(salesPage.slug));
        await page.locator('input[data-pack][value="3"]').check();
        await fillOrder(page, randomPhone(), { script: false });
        const order = await orderByCode(admin, await placeOrder(page));
        expect(order.totalWithTax).toBe(
            salesPage.settings.packs.find(item => item.quantity === 3)!.price + 6_000,
        );
        await context.close();
    });

    test('attribution keeps the last ad or link, not a direct visit, and cuts long values', async ({
        browser,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Once is enough');
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(
            pageUrl(salesPage.slug, `?utm_source=facebook&utm_campaign=first&fbclid=${'f'.repeat(400)}`),
        );
        let stored = await attributionCookie(context);
        expect(stored).toMatchObject({ source: 'facebook', campaign: 'first', salesPage: salesPage.id });
        expect(stored.fbclid).toHaveLength(255);
        // Back directly a day later: the ad stays.
        await page.goto(`${SITE}/en/`);
        expect((await attributionCookie(context)).campaign).toBe('first');
        // A Google ad: the new last touch.
        await page.goto(`${SITE}/en/?gclid=PWg1&utm_source=google&utm_campaign=second`);
        stored = await attributionCookie(context);
        expect(stored).toMatchObject({ source: 'google', campaign: 'second', gclid: 'PWg1', fbclid: '' });
        // Another site linking here counts too, by its host name only.
        await page.goto(`${SITE}/en/`, { referer: 'https://m.facebook.com/story.php?id=1' });
        expect(await attributionCookie(context)).toMatchObject({ referrer: 'm.facebook.com', campaign: '' });
        await context.close();
    });

    test('stock limits the packs, hides the add-on, and a sold-out product offers WhatsApp', async ({
        page,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Checked on the phone');
        test.setTimeout(60_000);
        try {
            await setSaleableStock(admin, products.honey.variantId, 2);
            await waitForStorefront(pageUrl(salesPage.slug), html => /value="3"[^>]*disabled/.test(html));
            await page.goto(pageUrl(salesPage.slug));
            await expect(page.locator('input[data-pack][value="3"]')).toBeDisabled();
            await expect(page.locator('input[data-pack][value="2"]')).toBeEnabled();
            await expect(page.locator('.pack-unavailable')).toContainText('Not enough in stock');

            await setSaleableStock(admin, products.spoon.variantId, 0);
            await waitForStorefront(pageUrl(salesPage.slug), html => !html.includes('data-bump'));

            await setSaleableStock(admin, products.honey.variantId, 0);
            await waitForStorefront(pageUrl(salesPage.slug), html => html.includes('data-order-unavailable'));
            // The browser keeps the page for a minute (it's cacheable): ask for a fresh copy.
            await page.goto(pageUrl(salesPage.slug, '?fresh=1'));
            await expect(page.getByText('Currently unavailable')).toBeVisible();
            await expect(page.locator('[data-order-unavailable] a.button-whatsapp')).toHaveAttribute(
                'href',
                /^https:\/\/wa\.me\/880\d{10}\?text=/,
            );
            // No order form and no order bar to tap.
            await expect(page.locator('[data-sales-form]')).toHaveCount(0);
            await expect(page.locator('[data-sticky-order]')).toHaveCount(0);
        } finally {
            await setSaleableStock(admin, products.honey.variantId, 500);
            await setSaleableStock(admin, products.spoon.variantId, 500);
        }
    });

    for (const template of LANDING_TEMPLATES) {
        test(`the ${template.id} template stays within the sales page budget`, async ({ page, isMobile }) => {
            test.skip(!isMobile, 'Measured on the phone');
            const made = await createSalesPage(admin, {
                title: `PW budget ${template.id} ${unique()}`,
                template: template.id,
                productId: products.honey.productId,
            });
            created.push(made.id);
            await publishSalesPage(admin, made);
            await waitForStorefront(pageUrl(made.slug), html => html.includes('data-sales-form'));
            const scripts: string[] = [];
            page.on('response', response => {
                if (response.request().resourceType() === 'script') scripts.push(response.url());
            });
            await page.goto(pageUrl(made.slug));
            await page.waitForLoadState('networkidle');
            let gzipped = 0;
            for (const url of scripts)
                gzipped += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
            const lcp = await page.evaluate(
                () =>
                    new Promise<number>(resolve => {
                        new PerformanceObserver(list => {
                            const entries = list.getEntries();
                            resolve(entries[entries.length - 1]!.startTime);
                        }).observe({ type: 'largest-contentful-paint', buffered: true });
                        setTimeout(() => resolve(-1), 3000);
                    }),
            );
            console.log(
                `${template.id}: ${(gzipped / 1024).toFixed(1)} KB first-party JS gzipped, LCP ${Math.round(lcp)} ms (local)`,
            );
            // Landing page with checkout: at most 45 KB (architecture.md, Decision 2); LCP within 1.5 s.
            expect(gzipped).toBeLessThanOrEqual(45 * 1024);
            expect(lcp).toBeGreaterThan(0);
            expect(lcp).toBeLessThan(1500);
        });
    }
});

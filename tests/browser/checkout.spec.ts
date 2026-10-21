import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { latestOtpCode } from './support/otp';
import {
    adminSession,
    type ApiSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from './support/store-api';

/**
 * Cart, checkout, thank-you and tracking on the storefront (roadmap phase 14): COD with and without
 * JavaScript, manual mobile banking, an advance, the SMS code, one order per tap, price and stock
 * changes, tracking and its limits, accessibility, the JS budget, and a timed checkout on a
 * throttled phone. Every order uses the "Playwright panjabi" (plenty in stock) and a random phone.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const PRODUCT_EN = `${SITE}/en/product/playwright-panjabi/`;
const PRODUCT_BN = `${SITE}/product/playwright-panjabi/`;
const DHAKA = 'BD3026';
const MIRPUR = 'BD3026M26';

let admin: ApiSession;
let variantId: string;
let paymentSettings: Record<string, unknown>;
let fraudSettings: Record<string, unknown>;

const randomTrx = () => `PW${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const e164 = (phone: string) => `+880${phone.slice(1)}`;

async function setPayments(change: (settings: Record<string, unknown>) => Record<string, unknown>) {
    const { updateBdPaymentSettings } = await admin.query(
        'mutation ($input: JSON!) { updateBdPaymentSettings(input: $input) { errors { path code } } }',
        { input: change(structuredClone(paymentSettings)) },
    );
    expect(updateBdPaymentSettings.errors).toEqual([]);
}

async function setOtp(mode: 'off' | 'all') {
    const settings = structuredClone(fraudSettings) as { otp: Record<string, unknown> };
    const { updateBdFraudSettings } = await admin.query(
        'mutation ($input: JSON!) { updateBdFraudSettings(input: $input) { errors { path code } } }',
        { input: { ...settings, otp: { ...settings.otp, mode } } },
    );
    expect(updateBdFraudSettings.errors).toEqual([]);
}

test.beforeAll(async () => {
    admin = await adminSession();
    variantId = await ensureCheckoutFixtures(admin);
    ({ bdPaymentSettings: paymentSettings } = await admin.query('{ bdPaymentSettings }'));
    ({ bdFraudSettings: fraudSettings } = await admin.query('{ bdFraudSettings }'));
    // COD on, bKash and Nagad set up, no advance, no SMS code (tests turn these on themselves).
    await setPayments(settings => ({
        ...settings,
        cod: { enabled: true, maxOrderTotal: null, zones: [] },
        mfs: {
            ...(settings.mfs as object),
            bkash: { enabled: true, number: '01812345678', accountType: 'personal' },
            nagad: { enabled: true, number: '01912345678', accountType: 'merchant' },
        },
        advance: { ...(settings.advance as object), enabled: false },
    }));
    await setOtp('off');
});

test.afterAll(async () => {
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

/** A browser without JavaScript (the plain forms). */
async function noScript(browser: Browser) {
    const context = await browser.newContext({ javaScriptEnabled: false });
    return { context, page: await context.newPage() };
}

/** Product page → "Buy now" → checkout (works with and without JavaScript). */
async function buyNow(page: Page, product = PRODUCT_EN) {
    await page.goto(product);
    await page.locator('[data-buy-form] button[value="buy"]').click();
    await expect(page).toHaveURL(/\/checkout\/$/);
}

/** Fills the checkout in English. Without JavaScript, "Show thanas" and "Update total" re-render. */
async function fillCheckout(page: Page, phone: string, { script = true } = {}) {
    const started = Date.now();
    await page.getByLabel('Your name').fill('PW Rahim Uddin');
    await page.getByLabel('Mobile number', { exact: true }).fill(phone);
    await page.getByLabel('District').selectOption(DHAKA);
    if (!script) await page.getByRole('button', { name: 'Show thanas' }).click();
    await expect(page.getByLabel('Thana / upazila').locator(`option[value="${MIRPUR}"]`)).toHaveCount(1);
    await page.getByLabel('Thana / upazila').selectOption(MIRPUR);
    await page.getByLabel('Full address').fill('House 12, Road 5, Mirpur 10');
    if (!script) await page.getByRole('button', { name: 'Update total' }).click();
    // The delivery charge is known: the summary shows it.
    await expect(page.locator('[data-part="summary"]')).toContainText('৳60');
    // Forms sent within 3 seconds look like a bot to the core (phase 11): take a person's time.
    await page.waitForTimeout(Math.max(0, 3200 - (Date.now() - started)));
}

const placeButton = (page: Page) => page.getByRole('button', { name: /^Place order/ });

async function placeAndThankYou(page: Page): Promise<string> {
    await placeButton(page).click();
    await expect(page).toHaveURL(/\/checkout\/thank-you\/\?order=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you! Your order is placed.');
    return (await page.locator('.thank-you-number').textContent())!.replace('Order number: ', '');
}

test.describe('checkout', () => {
    test('COD without JavaScript, in English, and the back button shows the order', async ({
        browser,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Desktop; the phone runs the JavaScript checkout');
        const { context, page } = await noScript(browser);
        await buyNow(page);
        await fillCheckout(page, randomPhone(), { script: false });
        const number = await placeAndThankYou(page);
        expect(number).toMatch(/^[A-Z0-9-]*\d+$/);
        await expect(page.getByText('We’ll call you soon to confirm your order.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Track this order' })).toHaveAttribute(
            'href',
            /^\/en\/t\/[\w-]{22}\/$/,
        );
        // Back to checkout: the order, not an empty form.
        await page.goto(`${SITE}/en/checkout/`);
        await expect(page).toHaveURL(/\/checkout\/thank-you\//);
        await context.close();
    });

    test('a COD order in Bangla on a throttled phone takes under 60 seconds', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'The phone project');
        // A mid-range Android on a slow 4G connection.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 150,
            downloadThroughput: (1.6 * 1024 * 1024) / 8,
            uploadThroughput: (750 * 1024) / 8,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const started = Date.now();
        await page.goto(PRODUCT_BN);
        await page.locator('[data-buy-form] button[value="add"]').click();
        // The drawer opens with the item, and the header counts it.
        const drawer = page.getByRole('dialog', { name: 'কার্ট' });
        await expect(drawer).toBeVisible();
        await expect(page.locator('[data-cart-count]')).not.toBeHidden();
        await drawer.getByRole('link', { name: 'চেকআউট' }).click();
        await expect(page).toHaveURL(`${SITE}/checkout/`);
        const onCheckout = Date.now();
        const phone = randomPhone();
        await page.getByLabel('আপনার নাম').pressSequentially('রহিম উদ্দিন', { delay: 20 });
        await page.getByLabel('মোবাইল নম্বর', { exact: true }).pressSequentially(phone, { delay: 20 });
        await expect(page.locator('#phone-operator')).toContainText('নম্বর');
        await page.getByLabel('জেলা', { exact: true }).selectOption(DHAKA);
        await expect(page.getByLabel('থানা / উপজেলা').locator(`option[value="${MIRPUR}"]`)).toHaveCount(1);
        await page.getByLabel('থানা / উপজেলা').selectOption(MIRPUR);
        await expect(
            page.locator('[data-part="delivery"] input[name="shippingMethodId"]').first(),
        ).toBeVisible();
        await page.getByLabel('পুরো ঠিকানা').pressSequentially('বাসা ১২, রোড ৫, মিরপুর ১০', { delay: 20 });
        // A person takes at least a few seconds (the core's bot check, phase 11).
        await page.waitForTimeout(Math.max(0, 3200 - (Date.now() - onCheckout)));
        await page.getByRole('button', { name: /^অর্ডার করুন/ }).click();
        await expect(page).toHaveURL(/\/checkout\/thank-you\/\?order=/, { timeout: 30_000 });
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('ধন্যবাদ! আপনার অর্ডার হয়েছে।');
        const seconds = (Date.now() - started) / 1000;
        console.log(`Throttled COD checkout: ${seconds.toFixed(1)} s`);
        expect(seconds).toBeLessThan(60);
        // No sideways scrolling on the checkout path.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
            false,
        );
    });

    test('full payment by Nagad: instructions, sender and TrxID', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        await buyNow(page);
        await fillCheckout(page, randomPhone());
        await page.getByLabel('Pay the full amount with Nagad').check();
        const panel = page
            .locator('.choice-block')
            .filter({ has: page.getByLabel('Pay the full amount with Nagad') });
        await expect(panel).toContainText('Make a Payment of ৳1,310 to Nagad 01912-345678');
        // A wrong TrxID is refused next to its field, and nothing else is lost.
        await panel.locator('input[name="senderNumber.nagad"]').fill('01712345678');
        await panel.locator('input[name="transactionId.nagad"]').fill('12');
        await placeButton(page).click();
        await expect(page.locator('[data-form-alert]')).toBeVisible();
        await expect(page.getByLabel('Your name')).toHaveValue('PW Rahim Uddin');
        await panel.locator('input[name="transactionId.nagad"]').fill(randomTrx());
        await placeAndThankYou(page);
        await expect(
            page.getByText('We’ll check your mobile banking payment and let you know.'),
        ).toBeVisible();
    });

    test('an advance by bKash, the rest on delivery', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        await setPayments(settings => ({
            ...settings,
            mfs: {
                ...(settings.mfs as object),
                bkash: { enabled: true, number: '01812345678', accountType: 'personal' },
                nagad: { enabled: true, number: '01912345678', accountType: 'merchant' },
            },
            advance: {
                ...(settings.advance as object),
                enabled: true,
                rule: 'fixed',
                fixed: 10000,
                scope: 'all',
            },
        }));
        try {
            await buyNow(page);
            await fillCheckout(page, randomPhone());
            const summary = page.locator('[data-part="summary"]');
            await expect(summary).toContainText('Pay now (advance)');
            await expect(summary).toContainText('৳100');
            await expect(
                page.getByText('Pay ৳100 in advance by mobile banking now; the rest on delivery.'),
            ).toBeVisible();
            await page.locator('input[name="advanceProvider"][value="bkash"]').check();
            await page.locator('#advanceSender').fill('01712345678');
            await page.locator('#advanceTransactionId').fill(randomTrx());
            await placeAndThankYou(page);
            await expect(page.locator('.thank-you')).toContainText('Pay on delivery: ৳1,210');
        } finally {
            await setPayments(settings => ({
                ...settings,
                mfs: {
                    ...(settings.mfs as object),
                    bkash: { enabled: true, number: '01812345678', accountType: 'personal' },
                    nagad: { enabled: true, number: '01912345678', accountType: 'merchant' },
                },
                advance: { ...(settings.advance as object), enabled: false },
            }));
        }
    });

    test('COD asks for the SMS code when the store wants one', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        await setOtp('all');
        try {
            const phone = randomPhone();
            await buyNow(page);
            await fillCheckout(page, phone);
            await placeButton(page).click();
            const otp = page.getByLabel('Code from SMS');
            await expect(otp).toBeVisible();
            await expect(page.getByText('We sent a 6-digit code by SMS to your number.')).toBeVisible();
            const code = await latestOtpCode(e164(phone));
            await otp.fill(code === '000000' ? '111111' : '000000');
            await placeButton(page).click();
            await expect(page.locator('#otp-error')).toBeVisible();
            await page.getByLabel('Code from SMS').fill(code);
            await placeAndThankYou(page);
        } finally {
            await setOtp('off');
        }
    });

    test('one order per tap: a double submit and a retry give the same order', async ({
        browser,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const { context, page } = await noScript(browser);
        await buyNow(page);
        await fillCheckout(page, randomPhone(), { script: false });
        const fields = await page
            .locator('[data-checkout-form]')
            .evaluate(
                form => Object.fromEntries(new FormData(form as HTMLFormElement)) as Record<string, string>,
            );
        const place = () =>
            page.request.post(`${SITE}/en/checkout/`, {
                form: { ...fields, action: 'place' },
                maxRedirects: 0,
            });
        const [first, second] = await Promise.all([place(), place()]);
        expect([first.status(), second.status()]).toEqual([303, 303]);
        const location = first.headers().location!;
        expect(location).toMatch(/\/checkout\/thank-you\/\?order=/);
        expect(second.headers().location).toBe(location);
        // A retry after a timeout: the same order again.
        expect((await place()).headers().location).toBe(location);
        await context.close();
    });

    test('a price change shows the new total before placing', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const { context, page } = await noScript(browser);
        await buyNow(page);
        await fillCheckout(page, randomPhone(), { script: false });
        const update = (price: number) =>
            admin.query(
                'mutation ($input: [UpdateProductVariantInput!]!) { updateProductVariants(input: $input) { id } }',
                {
                    input: [{ id: variantId, price }],
                },
            );
        await update(130000);
        try {
            await placeButton(page).click();
            await expect(page.locator('[data-form-alert]')).toHaveText(
                'The total has changed. Please check it, then place the order again.',
            );
            await expect(placeButton(page)).toHaveText('Place order · ৳1,360');
            await placeAndThankYou(page);
        } finally {
            await update(125000);
            await context.close();
        }
    });

    test('an item that sells out during checkout leaves the cart with a message', async ({
        browser,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const slug = `playwright-last-one-${Date.now()}`;
        const { createProduct } = await admin.query(
            `mutation ($slug: String!) { createProduct(input: { translations: [{ languageCode: en, name: "Playwright last one",
                slug: $slug, description: "" }] }) { id } }`,
            { slug },
        );
        const { createProductVariants } = await admin.query(
            `mutation ($productId: ID!) { createProductVariants(input: [{ productId: $productId, sku: "${slug}",
                price: 50000, stockOnHand: 3, translations: [{ languageCode: en, name: "Playwright last one" }] }]) { id } }`,
            { productId: createProduct.id },
        );
        const { context, page } = await noScript(browser);
        try {
            await page.goto(PRODUCT_EN);
            await page.locator('[data-buy-form] button[value="add"]').click();
            await expect
                .poll(async () => (await page.request.get(`${SITE}/en/product/${slug}/`)).status())
                .toBe(200);
            await buyNow(page, `${SITE}/en/product/${slug}/`);
            await fillCheckout(page, randomPhone(), { script: false });
            await admin.query(
                'mutation ($input: [UpdateProductVariantInput!]!) { updateProductVariants(input: $input) { id } }',
                { input: [{ id: createProductVariants[0].id, stockOnHand: 0 }] },
            );
            await placeButton(page).click();
            await expect(page.locator('[data-form-alert]')).toContainText('Playwright last one');
            await expect(page.locator('[data-part="summary"]')).not.toContainText('Playwright last one');
            await placeAndThankYou(page);
        } finally {
            await context.close();
            await admin.query('mutation ($id: ID!) { deleteProduct(id: $id) { result } }', {
                id: createProduct.id,
            });
        }
    });

    test('cart and checkout have no serious accessibility problems', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        await page.goto(PRODUCT_EN);
        await page.locator('[data-buy-form] button[value="add"]').click();
        await expect(page.getByRole('dialog', { name: 'Cart' })).toBeVisible();
        for (const path of ['/en/cart/', '/en/checkout/']) {
            await page.goto(`${SITE}${path}`);
            const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
            const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
            expect(
                serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`),
                path,
            ).toEqual([]);
        }
    });

    test('the checkout stays within the 45 KB JavaScript budget', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        await page.goto(PRODUCT_EN);
        await page.locator('[data-buy-form] button[value="add"]').click();
        await expect(page.getByRole('dialog', { name: 'Cart' })).toBeVisible();
        const scripts: string[] = [];
        page.on('response', response => {
            if (response.request().resourceType() === 'script') scripts.push(response.url());
        });
        await page.goto(`${SITE}/en/checkout/`);
        await page.waitForLoadState('networkidle');
        let gzipped = 0;
        for (const url of scripts)
            gzipped += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
        console.log(`First-party JS on checkout: ${(gzipped / 1024).toFixed(1)} KB gzipped`);
        expect(gzipped).toBeGreaterThan(0);
        expect(gzipped).toBeLessThanOrEqual(45 * 1024);
    });

    test('the cart page works without JavaScript: more, fewer, remove', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const { context, page } = await noScript(browser);
        await page.goto(PRODUCT_EN);
        await page.locator('[data-buy-form] button[value="add"]').click();
        await expect(page).toHaveURL(`${SITE}/en/cart/`);
        const line = page.locator('.cart-line');
        await line.getByRole('button', { name: 'One more' }).click();
        await expect(line.locator('.quantity-value')).toHaveText('2');
        await line.getByRole('button', { name: 'One less' }).click();
        await expect(line.locator('.quantity-value')).toHaveText('1');
        await line.getByRole('button', { name: 'Remove' }).click();
        await expect(page.getByText('Your cart is empty.')).toBeVisible();
        await context.close();
    });
});

test.describe('order tracking', () => {
    async function placedOrder() {
        const phone = randomPhone();
        const code = await placePhoneOrder({ variantId, name: 'PW Karim Mia', phone });
        const { orders } = await admin.query(
            'query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items { customFields { orderNumber } } } }',
            { code },
        );
        return { phone, number: orders.items[0].customFields.orderNumber as string };
    }

    test('by order number and phone: first name, status, never the address', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const { phone, number } = await placedOrder();
        await page.goto(`${SITE}/en/track/`);
        await page.getByLabel('Order number').fill(number);
        await page.getByLabel('Mobile number', { exact: true }).fill(phone);
        await page.getByRole('button', { name: 'Track order' }).click();
        await expect(page.getByRole('heading', { name: `Order number: ${number}` })).toBeVisible();
        await expect(page.locator('.timeline')).toContainText('Order received');
        await expect(page.locator('.tracked-order')).toContainText('For PW, Dhaka');
        await expect(page.locator('.tracked-order')).not.toContainText(phone);
        // The phone was posted: it isn't in the address bar.
        expect(page.url()).toBe(`${SITE}/en/track/`);
        // A wrong phone reads exactly like a wrong number.
        await page.goto(`${SITE}/en/track/`);
        await page.getByLabel('Order number').fill(number);
        await page.getByLabel('Mobile number', { exact: true }).fill(randomPhone());
        await page.getByRole('button', { name: 'Track order' }).click();
        await expect(page.getByRole('alert')).toHaveText(
            'No order matches this number and phone. Please check both.',
        );
    });

    test('guessing order numbers hits the limit and shows nothing', async ({ request }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const phone = randomPhone();
        let refused = false;
        for (let attempt = 0; attempt < 12 && !refused; attempt++) {
            const response = await request.post(`${SITE}/en/track/`, {
                form: { orderNumber: String(1000 + attempt), phone },
            });
            const html = await response.text();
            expect(html).not.toContain('class="tracked-order"');
            refused = response.status() === 429;
            if (refused) expect(html).toContain('Too many tries. Please wait a few minutes and try again.');
        }
        expect(refused).toBe(true);
    });
});

test.describe('phone layout', () => {
    test('the checkout fits a phone screen', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Phone layout');
        await page.goto(PRODUCT_BN);
        await page.locator('[data-buy-form] button[value="buy"]').click();
        await expect(page).toHaveURL(`${SITE}/checkout/`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
            false,
        );
        await expect(page.getByRole('button', { name: /^অর্ডার করুন/ })).toBeVisible();
    });
});

import { test, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { signIn, watchForErrors } from './support/admin-ui';

const BASE = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';
const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../apps/core/test/fixtures/woo/wordpress-export.json'), 'utf8'),
);

test('migrates a signed helper upload, reviews reports/history and manages redirects and cutover', async ({
    page,
    request,
}, testInfo) => {
    const errors = watchForErrors(page);
    await signIn(page, 'en');
    await page.goto('/admin/settings/woocommerce');
    await expect(page.getByRole('heading', { name: 'WooCommerce migration', exact: true })).toBeVisible();
    await page.getByLabel('WooCommerce store URL (HTTPS)').first().fill('https://woo.fixture.test');
    await page.getByRole('button', { name: 'Create one-use pairing', exact: true }).click();
    const details = page.getByLabel('Pairing details (valid for one hour)');
    await expect(details).toHaveValue(/"code"/);
    const pair = JSON.parse(await details.inputValue());
    const paired = await request.post(`${BASE}/woo-migrate/pair`, {
        data: { code: pair.code, sourceUrl: 'https://woo.fixture.test' },
    });
    expect(paired.status()).toBe(201);
    const session = await paired.json();
    let sequence = 0;
    const counts: Record<string, number> = {};
    for (const kind of [
        'categories',
        'tags',
        'products',
        'customers',
        'orders',
        'coupons',
        'reviews',
        'settings',
        'finish',
    ]) {
        const records = kind === 'finish' ? [] : fixture[kind];
        if (kind !== 'finish') counts[kind] = records.length;
        const payload = JSON.stringify({
            records,
            ...(kind === 'finish' ? { manifest: { ...fixture.settings[0], counts } } : {}),
        });
        const time = String(Math.floor(Date.now() / 1000));
        const nonce = randomBytes(16).toString('hex');
        const signature = createHmac('sha256', session.token)
            .update(`${time}\n${nonce}\n${sequence}\n${kind}\n${payload}`)
            .digest('hex');
        const result = await request.post(`${BASE}/woo-migrate/upload/${session.id}`, {
            data: { sequence, kind, payload },
            headers: { 'x-woo-time': time, 'x-woo-nonce': nonce, 'x-woo-signature': signature },
        });
        expect(result.status(), await result.text()).toBe(201);
        sequence++;
    }
    await page.reload();
    await page
        .getByLabel('Source store', { exact: true })
        .selectOption({ label: 'https://woo.fixture.test' });
    await page.getByRole('button', { name: 'Run dry run', exact: true }).click();
    await expect(page.getByText('Status: Completed', { exact: false })).toBeVisible({ timeout: 60000 });
    await page.getByLabel('I reviewed the dry-run issues and accept the reported exclusions.').check();
    await page.getByRole('button', { name: 'Import reviewed data', exact: true }).click();
    await expect(page.getByText('Status: Completed', { exact: false })).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('Fixture', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'WooCommerce order history' })).toBeVisible();
    await page.getByRole('button', { name: 'Details', exact: true }).first().click();
    await expect(page.getByText(/Original order snapshot/)).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download HTML report' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('migration-report.html');
    await page.getByText('Imported source settings', { exact: true }).click();
    await expect(page.getByText('Imported Meta Pixel ID: ' + fixture.settings[0].pixelId)).toBeVisible();
    await page
        .getByLabel('Orders placed since (your local time)', { exact: true })
        .fill(new Date(Date.now() - 86400_000).toISOString().slice(0, 16));
    const rollbackPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export private rollback orders', exact: true }).click();
    const rollback = await rollbackPromise;
    expect(rollback.suggestedFilename()).toBe('private-rollback-orders.json');
    const exported = JSON.parse(fs.readFileSync((await rollback.path())!, 'utf8'));
    expect(exported.orders).toBeInstanceOf(Array);
    expect(JSON.stringify(exported)).not.toMatch(
        /passwordHash|_password_hash|verificationToken|trackingToken/,
    );
    const old = `/browser-old-${testInfo.project.name}-${randomBytes(4).toString('hex')}/`;
    await page.getByLabel('Old local path', { exact: true }).fill(old);
    await page.getByLabel('Final local path', { exact: true }).fill('/product/fixture-panjabi/');
    await page.getByRole('button', { name: 'Save redirect', exact: true }).click();
    await expect(page.getByText(`${old} → /product/fixture-panjabi/ · 0`, { exact: true })).toBeVisible();
    const moved = await request.get(SITE + old, { maxRedirects: 0 });
    expect(moved.status()).toBe(301);
    expect(moved.headers().location).toBe('/product/fixture-panjabi/');
    expect((await request.get(SITE + old)).status()).toBe(200);
    const query = await request.get(SITE + '/?p=' + fixture.products[0].id, { maxRedirects: 0 });
    expect(query.status()).toBe(301);
    await page.getByLabel('Backups and permission recorded', { exact: true }).check();
    await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
    await page.reload();
    await page
        .getByLabel('Source store', { exact: true })
        .selectOption({ label: 'https://woo.fixture.test' });
    await expect(page.getByLabel('Backups and permission recorded', { exact: true })).toBeChecked();
    if (testInfo.project.name === 'phone') {
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        expect(overflow).toBe(false);
        await page.screenshot({ path: testInfo.outputPath('migration-phone.png'), fullPage: true });
    }
    expect(errors).toEqual([]);
});

test('shows Bangla helper, history and cutover controls without script errors', async ({ page }) => {
    const errors = watchForErrors(page);
    await signIn(page, 'bn');
    await page.goto('/admin/settings/woocommerce');
    await expect(page.getByRole('heading', { name: 'WooCommerce মাইগ্রেশন', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'একবারের পেয়ারিং তৈরি করুন', exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'WooCommerce অর্ডারের ইতিহাস', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

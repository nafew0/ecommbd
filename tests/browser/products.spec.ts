import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, type ApiSession, ensureCheckoutFixtures, randomPhone } from './support/store-api';

/**
 * Products and phone orders in the merchant admin (roadmap phase 05), on a desktop and a phone:
 * a product with three sizes and a gallery on one page, and a Messenger order in under a minute.
 */

let admin: ApiSession;

const photo = (background: string) =>
    sharp({ create: { width: 600, height: 600, channels: 3, background } })
        .png()
        .toBuffer();

async function upload(page: Page, label: string, buffer: Buffer) {
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByLabel(new RegExp(`^${label}`)).click(),
    ]);
    await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer });
}

test.beforeAll(async () => {
    admin = await adminSession();
    await ensureCheckoutFixtures(admin);
});

test('adds a product with three sizes and a gallery photo on one page, in Bangla', async ({ page }) => {
    const errors = watchForErrors(page);
    const name = `PW পাঞ্জাবি ${Date.now()}`;
    await signIn(page, 'bn');
    await page.goto('/admin/products/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('নতুন পণ্য');

    await page.getByLabel('বাংলায় নাম', { exact: true }).fill(name);
    await page.getByLabel(/^ইংরেজিতে নাম/).fill('PW Panjabi');
    await upload(page, 'প্রধান ছবি', await photo('#c85028'));
    await expect(page.getByLabel(/^প্রধান ছবি/)).toHaveText('বদলান');
    await upload(page, 'আরও ছবি', await photo('#2060c0'));
    await expect(page.locator('img[src*="preset=thumb"]')).toHaveCount(2);

    await page.getByLabel('পণ্যটি পাওয়া যায়').selectOption('size');
    for (let i = 0; i < 2; i += 1) {
        await page.getByRole('button', { name: 'ভ্যারিয়েশন যোগ করুন' }).click();
    }
    const rows = page.getByRole('listitem').filter({ has: page.getByLabel('ভ্যারিয়েশনের নাম (বাংলায়)') });
    await expect(rows).toHaveCount(3);
    for (const [index, size] of ['M', 'L', 'XL'].entries()) {
        const row = rows.nth(index);
        await row.getByLabel('ভ্যারিয়েশনের নাম (বাংলায়)').fill(size);
        const price = row.getByLabel('দাম', { exact: true });
        await price.fill(String(1250 + index * 50));
        await price.blur();
        await row.getByLabel('স্টক', { exact: true }).fill('১০');
    }
    await page.getByRole('button', { name: 'পণ্য সেভ করুন' }).click();
    await expect(page.getByText('পণ্য সেভ হয়েছে।')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/\d+$/);

    const { bdProducts } = await admin.query(
        'query ($search: String) { bdProducts(search: $search) { items { id name price stock variantCount } } }',
        { search: name },
    );
    expect(bdProducts.items[0]).toMatchObject({ name, price: 125000, stock: 30, variantCount: 3 });
    const { bdProductForm } = await admin.query('query ($id: ID!) { bdProductForm(id: $id) }', {
        id: bdProducts.items[0].id,
    });
    expect(bdProductForm.galleryAssetIds).toHaveLength(1);
    if (test.info().project.name === 'phone') {
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(sideways).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
});

test('takes a Messenger order in under a minute', async ({ page }) => {
    const errors = watchForErrors(page);
    await signIn(page, 'bn');
    const started = Date.now();
    await page.goto('/admin/orders/phone');
    await page.getByLabel('মোবাইল নম্বর', { exact: true }).fill(randomPhone());
    await page.getByLabel('নাম', { exact: true }).fill('PW মেসেঞ্জার কাস্টমার');
    await page.getByLabel('জেলা', { exact: true }).selectOption('BD3026');
    await page.getByLabel('থানা / উপজেলা').selectOption('BD3026M26');
    await page.getByLabel('বাসা, রাস্তা, গ্রাম').fill('বাসা ৭, রোড ২, মিরপুর ১০');
    await page.getByLabel('নাম বা SKU দিয়ে পণ্য খুঁজুন').fill('Playwright panjabi');
    await page
        .getByRole('button', { name: /Playwright panjabi/ })
        .first()
        .click();
    // The server works out the total (delivery from the store's rules).
    await expect(page.getByText('অর্ডারের মোট')).toBeVisible();
    await expect(page.locator('dl')).toContainText('৳');
    await page.getByRole('button', { name: 'অর্ডার তৈরি করুন' }).click();
    await expect(page.getByText('অর্ডার তৈরি হয়েছে।')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders\/\d+$/);
    expect(Date.now() - started).toBeLessThan(60_000);
    // Confirmed with the customer by default: no confirmation call needed.
    await expect(page.getByText('কনফার্মড').first()).toBeVisible();
    expect(errors).toEqual([]);
});

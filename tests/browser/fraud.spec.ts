import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, ApiSession, ensureCheckoutFixtures, randomPhone } from './support/store-api';

/** Incomplete orders and the block list in the merchant admin (roadmap phase 11), on a desktop and a phone. */

let variantId: string;

test.beforeAll(async () => {
    variantId = await ensureCheckoutFixtures(await adminSession());
});

test('turns an incomplete checkout into a phone order, in Bangla', async ({ page }) => {
    const errors = watchForErrors(page);
    // A shopper puts the panjabi in the cart, types a phone and leaves.
    const phone = randomPhone();
    const shop = new ApiSession('shop-api');
    await shop.query('mutation ($id: ID!) { addItemToOrder(productVariantId: $id, quantity: 2) { __typename } }', {
        id: variantId,
    });
    await shop.query('mutation ($input: BdCheckoutProgressInput!) { saveCheckoutProgress(input: $input) }', {
        input: { phone, name: 'Playwright Karim', districtId: 'BD3026', thanaId: 'BD3026M26' },
    });

    await signIn(page, 'bn');
    await page.goto('/admin/orders/incomplete');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('অসম্পূর্ণ অর্ডার');
    await page.getByPlaceholder(/ফোন দিয়ে খুঁজুন/).fill(phone.slice(-6));
    // Earlier runs leave other rows: find this one by its phone digits.
    const row = page.getByRole('row').filter({ hasText: phone.slice(-6) });
    await expect(row).toContainText('Playwright Karim');
    await expect(row).toContainText('Playwright panjabi');
    await row.getByRole('link', { name: 'অর্ডার তৈরি করুন' }).click();

    await expect(page).toHaveURL(/\/admin\/orders\/phone\?incomplete=/);
    await expect(page.getByText('অসম্পূর্ণ অর্ডার থেকে পূরণ করা হয়েছে', { exact: false })).toBeVisible();
    await expect(page.getByText('Playwright panjabi').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'নাম', exact: true }).first()).toHaveValue('Playwright Karim');
    expect(errors).toEqual([]);
});

test('blocks a phone and unblocks it with a reason, in Bangla', async ({ page }) => {
    const errors = watchForErrors(page);
    const phone = randomPhone();
    await signIn(page, 'bn');
    await page.goto('/admin/customers/blocked');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ব্লক তালিকা');
    await page.getByLabel('ফোন নম্বর বা আইপি').fill(phone);
    await page.getByRole('button', { name: 'ব্লক করুন' }).click();
    await expect(page.getByText('ব্লক করা হয়েছে।')).toBeVisible();

    await page.getByPlaceholder('ফোন বা আইপি দিয়ে খুঁজুন').fill(phone.slice(-7));
    const row = page.getByRole('row').filter({ hasText: phone.slice(-6) });
    await expect(row).toContainText('সবসময়');
    await row.getByRole('button', { name: 'আনব্লক করুন' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/কেন/).fill('গ্রাহক ফোন করে জানিয়েছেন');
    await dialog.getByRole('button', { name: 'আনব্লক করুন' }).click();
    await expect(page.getByText('আনব্লক করা হয়েছে।')).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, ensureCheckoutFixtures, placePhoneOrder, randomPhone } from './support/store-api';

/**
 * Customers in the merchant admin (roadmap phase 03): the list is keyed by phone, searchable by
 * the last digits, and never shows a placeholder email.
 */
test.describe('customers', () => {
    let phone: string;
    const name = `রহিম ${Date.now() % 100000}`;

    test.beforeAll(async () => {
        const variantId = await ensureCheckoutFixtures(await adminSession());
        phone = randomPhone();
        await placePhoneOrder({ variantId, name, phone });
    });

    test('finds a phone customer by the last digits, in Bangla; no placeholder email anywhere', async ({
        page,
    }) => {
        const errors = watchForErrors(page);
        await signIn(page, 'bn');
        await page.goto('/admin/customers');
        await expect(page.getByRole('heading', { name: 'কাস্টমার' })).toBeVisible();
        await page.getByRole('searchbox').fill(phone.slice(-6));
        const row = page.getByRole('row').filter({ hasText: name });
        await expect(row).toBeVisible();
        await expect(row).toContainText(`${phone.slice(0, 5)}-${phone.slice(5)}`);
        await expect(page.locator('body')).not.toContainText('phone.invalid');

        await row.getByRole('link', { name }).click();
        await expect(page.getByRole('heading', { name })).toBeVisible();
        await expect(page.getByRole('link', { name: /নম্বরে কল করুন/ })).toHaveAttribute(
            'href',
            `tel:+880${phone.slice(1)}`,
        );
        await expect(page.getByText('ইমেইল নেই')).toBeVisible();
        await expect(page.locator('body')).not.toContainText('phone.invalid');
        expect(errors).toEqual([]);
    });

    test('saves internal notes on the customer', async ({ page }) => {
        await signIn(page, 'en');
        await page.goto('/admin/customers');
        await page.getByRole('searchbox').fill(phone);
        await page.getByRole('link', { name }).click();
        const note = `Call after 5 pm (${Date.now() % 1000})`;
        await page.getByLabel('Internal notes').fill(note);
        await page.getByRole('button', { name: 'Save notes' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Notes saved.' })).toBeVisible();
        await page.reload();
        await expect(page.getByLabel('Internal notes')).toHaveValue(note);
    });
});

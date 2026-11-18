import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession } from './support/store-api';

/** Accounts and profit and loss (phase 53), in Bangla. */
test('opens accounts and the profit report in Bangla', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const admin = await adminSession();
    const { saveBdAccount } = await admin.query(
        `mutation ($input: JSON!) {
            saveBdAccount(input: $input) { account { id name } errors { path } }
        }`,
        { input: { name: 'PW ক্যাশ', kind: 'cash', openingBalance: 25000 } },
    );
    expect(saveBdAccount.errors).toEqual([]);

    await signIn(page, 'bn');
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading', { name: 'অ্যাকাউন্ট' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PW ক্যাশ' }).first()).toBeVisible();
    await expect(page.getByText('৳২৫০').first()).toBeVisible();
    await page.goto('/admin/accounts/profit');
    await expect(page.getByRole('heading', { name: 'লাভ-লোকসান' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'প্রিন্ট' })).toBeVisible();
    await page.screenshot({ path: `test-results/accounts-${testInfo.project.name}.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]);
});

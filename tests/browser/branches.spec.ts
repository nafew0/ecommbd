import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession } from './support/store-api';

/** Branches (phase 54), in Bangla: a new branch shows on the list. */
test('shows a branch in Bangla', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const admin = await adminSession();
    const name = `PW শাখা ${Date.now()}`;
    const { saveBdBranch } = await admin.query(
        `mutation ($input: JSON!) {
            saveBdBranch(input: $input) { branch { id name } errors { path code } }
        }`,
        {
            input: {
                name,
                phone: '01711100099',
                districtId: 'BD3026',
                thanaId: 'BD3026M26',
                addressLine: 'রোড ১',
                note: '',
                sellsOnline: true,
            },
        },
    );
    expect(saveBdBranch.errors).toEqual([]);

    await signIn(page, 'bn');
    await page.goto('/admin/products/branches');
    await expect(page.getByRole('heading', { name: 'শাখা' })).toBeVisible();
    await expect(page.getByRole('link', { name })).toBeVisible();
    await page.screenshot({ path: `test-results/branches-${testInfo.project.name}.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]);
});

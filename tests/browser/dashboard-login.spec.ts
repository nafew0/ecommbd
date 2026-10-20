import { expect, test } from '@playwright/test';

const username = process.env.SUPERADMIN_USERNAME ?? 'superadmin';
const password = process.env.SUPERADMIN_PASSWORD ?? 'superadmin';

// Vendure's Dashboard stays at /dashboard for our support team. Merchants use /admin (admin.spec.ts).
test.describe('Vendure Dashboard (support team)', () => {
    test('a staff member can still sign in', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'The support team uses the Dashboard on a desktop');
        await page.goto('/dashboard/');
        await expect(page).toHaveURL(/\/dashboard\/login/);
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    });
});

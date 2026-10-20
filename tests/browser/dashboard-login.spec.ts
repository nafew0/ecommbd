import { expect, test } from '@playwright/test';

const username = process.env.SUPERADMIN_USERNAME ?? 'superadmin';
const password = process.env.SUPERADMIN_PASSWORD ?? 'superadmin';

test.describe('Dashboard login', () => {
    test('a staff member can log in', async ({ page }) => {
        await page.goto('/dashboard/');
        await expect(page).toHaveURL(/\/dashboard\/login/);
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    });

    test('a wrong password is refused', async ({ page }) => {
        await page.goto('/dashboard/login');
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="password"]').fill('definitely-not-the-password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await page.waitForTimeout(2_000);
        await expect(page).toHaveURL(/\/login/);
    });
});

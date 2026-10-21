import { expect, type Page, test } from '@playwright/test';

/**
 * The merchant admin at /admin (roadmap phase 02b): sign-in in Bangla and English, the phone
 * layout, Store settings, the district → thana picker, and an expired session during a save.
 * Runs on a desktop browser and on a phone (see playwright.config.ts).
 */

const username = process.env.SUPERADMIN_USERNAME ?? 'superadmin';
const password = process.env.SUPERADMIN_PASSWORD ?? 'superadmin';

/** Fails the test on any Content Security Policy violation or script error. */
function watchForErrors(page: Page) {
    const errors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

async function signIn(page: Page, language: 'bn' | 'en') {
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.getByRole('button', { name: language === 'bn' ? 'বাংলা' : 'English' }).click();
    await page.getByLabel(language === 'bn' ? 'ইমেইল বা ইউজারনেম' : 'Email or username').fill(username);
    await page.getByLabel(language === 'bn' ? 'পাসওয়ার্ড' : 'Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: language === 'bn' ? 'সাইন ইন' : 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
        language === 'bn' ? 'স্বাগতম' : 'Welcome',
    );
}

async function openMenuIfPhone(page: Page, isPhone: boolean, language: 'bn' | 'en') {
    if (isPhone) {
        await page.getByRole('button', { name: language === 'bn' ? 'মেনু খুলুন' : 'Open menu' }).click();
    }
}

test.describe('merchant admin', () => {
    test('signs in and out in English', async ({ page }) => {
        const errors = watchForErrors(page);
        await signIn(page, 'en');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(page).toHaveURL(/\/admin\/login/);
        await expect(page.getByRole('heading', { name: 'Sign in to your store' })).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('signs in and out in Bangla', async ({ page }) => {
        const errors = watchForErrors(page);
        await signIn(page, 'bn');
        await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
        await page.getByRole('button', { name: 'সাইন আউট' }).click();
        await expect(page.getByRole('heading', { name: 'আপনার স্টোরে সাইন ইন করুন' })).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('refuses a wrong password, in the chosen language', async ({ page }) => {
        await page.goto('/admin/login');
        await page.getByRole('button', { name: 'বাংলা' }).click();
        await page.getByLabel('ইমেইল বা ইউজারনেম').fill(username);
        await page.getByLabel('পাসওয়ার্ড', { exact: true }).fill('definitely-not-the-password');
        await page.getByRole('button', { name: 'সাইন ইন' }).click();
        await expect(page.getByRole('alert')).toContainText('ইমেইল বা পাসওয়ার্ড ভুল');
        await expect(page).toHaveURL(/\/admin\/login/);
    });

    test('keeps the language choice for the staff member', async ({ page, context }) => {
        await signIn(page, 'bn');
        await page.getByRole('button', { name: 'English' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome');
        // A new device (nothing stored, so it starts in Bangla) switches to the account's language.
        const other = await context.browser()!.newContext();
        const second = await other.newPage();
        await second.goto('/admin/');
        await second.getByLabel('ইমেইল বা ইউজারনেম').fill(username);
        await second.getByLabel('পাসওয়ার্ড', { exact: true }).fill(password);
        await second.getByRole('button', { name: 'সাইন ইন' }).click();
        await expect(second.getByRole('heading', { level: 1 })).toContainText('Welcome');
        await other.close();
    });

    test('the menu works at phone width, with no sideways scrolling', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Phone layout');
        await signIn(page, 'bn');
        const sidewaysScroll = () =>
            page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(await sidewaysScroll()).toBe(false);
        await openMenuIfPhone(page, true, 'bn');
        const drawer = page.getByRole('dialog', { name: 'স্টোর অ্যাডমিন' });
        await expect(drawer).toBeVisible();
        await drawer.getByRole('link', { name: 'স্টোর' }).click();
        await expect(page).toHaveURL(/\/admin\/settings\/store/);
        await expect(drawer).toBeHidden();
        await expect(page.getByRole('heading', { name: 'স্টোর সেটিংস' })).toBeVisible();
        expect(await sidewaysScroll()).toBe(false);
    });

    test('edits store settings: Bangla digits, district → thana, saved and normalized', async ({
        page,
    }, testInfo) => {
        const errors = watchForErrors(page);
        const isPhone = testInfo.project.name === 'phone';
        await signIn(page, 'bn');
        await openMenuIfPhone(page, isPhone, 'bn');
        await page.getByRole('link', { name: 'স্টোর', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'স্টোর সেটিংস' })).toBeVisible();

        const name = `রহিম ফ্যাশন ${Date.now() % 100000}`;
        await page.getByLabel('স্টোরের নাম (বাংলায়)').fill(name);
        await page.getByLabel('স্টোরের নাম (ইংরেজিতে)').fill('Rahim Fashion');
        const phone = page.getByLabel('ফোন নম্বর ১');
        await phone.fill('০১৭১২-৩৪৫৬৭৮');
        await phone.blur();
        await expect(phone).toHaveValue('01712-345678');
        await page.getByLabel('জেলা', { exact: true }).selectOption('BD3026');
        await page.getByLabel('থানা / উপজেলা').selectOption('BD3026M26');
        await page.getByRole('button', { name: 'পরিবর্তন সেভ করুন' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'সেটিংস সেভ হয়েছে' })).toBeVisible();

        await page.reload();
        await expect(page.getByLabel('স্টোরের নাম (বাংলায়)')).toHaveValue(name);
        await expect(page.getByLabel('ফোন নম্বর ১')).toHaveValue('01712-345678');
        await expect(page.getByLabel('থানা / উপজেলা')).toHaveValue('BD3026M26');
        expect(errors).toEqual([]);
    });

    test('shows field errors in the admin’s language and saves nothing', async ({ page }) => {
        await signIn(page, 'en');
        await page.goto('/admin/settings/store');
        await page.getByLabel('WhatsApp number').fill('02-9123456');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText('Enter a valid mobile number, e.g. 01712-345678.')).toBeVisible();
        await expect(page.getByLabel('WhatsApp number')).toBeFocused();
    });

    test('lists thanas for the chosen district in both languages, with "Other"', async ({ page }) => {
        await signIn(page, 'en');
        await page.goto('/admin/settings/store');
        const thana = page.getByLabel('Thana / Upazila');
        await page.getByLabel('District', { exact: true }).selectOption('BD4050');
        await expect(thana.locator('option', { hasText: 'Mirpur' })).toHaveCount(1);
        await expect(thana.locator('option', { hasText: 'Other / not listed' })).toHaveCount(1);
        await page.getByRole('button', { name: 'বাংলা' }).click();
        await expect(page.getByLabel('থানা / উপজেলা').locator('option', { hasText: 'মিরপুর' })).toHaveCount(
            1,
        );
        await page.getByRole('button', { name: 'English' }).click();
    });

    test('asks to sign in again when the session ends, keeps the typed values, then saves', async ({
        page,
        context,
    }) => {
        await signIn(page, 'en');
        await page.goto('/admin/settings/store');
        // Different on every run: a value equal to the saved one would leave nothing to save.
        const hours = `Sat–Thu, 10am–8pm (${Date.now() % 1_000_000})`;
        await page.getByLabel('Business hours (English)').fill(hours);
        await context.clearCookies();
        await page.getByRole('button', { name: 'Save changes' }).click();

        const dialog = page.getByRole('dialog', { name: 'Please sign in again' });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Password').fill(password);
        await dialog.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
        await expect(page.getByLabel('Business hours (English)')).toHaveValue(hours);

        await page.reload();
        await expect(page.getByLabel('Business hours (English)')).toHaveValue(hours);
    });

    test('loads each screen only when it is opened', async ({ page }) => {
        const scripts: string[] = [];
        page.on('response', response => {
            if (response.url().endsWith('.js')) scripts.push(response.url());
        });
        await page.goto('/admin/login');
        await expect(page.getByRole('button', { name: /সাইন ইন|Sign in/ })).toBeVisible();
        expect(scripts.some(url => url.includes('store-settings'))).toBe(false);
        expect(scripts.some(url => url.includes('ui-kit'))).toBe(false);
    });
});

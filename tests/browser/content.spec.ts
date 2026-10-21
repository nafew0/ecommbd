import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession } from './support/store-api';

/**
 * Online store → Pages and Menus in the merchant admin (roadmap phase 12), checked on the
 * storefront: a page written in Bangla with formatting, a refused address, a header menu link.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';

test.describe('pages and menus', () => {
    test('writes a page in Bangla and English, and it appears on the storefront', async ({
        page,
    }, testInfo) => {
        const errors = watchForErrors(page);
        const suffix = `${testInfo.project.name}-${Date.now()}`;
        await signIn(page, 'bn');
        await page.goto('/admin/store/pages');
        await expect(page.getByRole('heading', { name: 'পেজ', exact: true })).toBeVisible();
        await page.getByRole('link', { name: 'নতুন পেজ' }).first().click();

        await page.getByLabel('টাইটেল', { exact: true }).first().fill('ডেলিভারির তথ্য');
        await page.getByLabel('ওয়েব ঠিকানা').first().fill(`delivery-${suffix}`);
        const editor = page.getByRole('textbox', { name: 'লেখা' }).first();
        await editor.click();
        await page.keyboard.type('ঢাকার ভেতরে ১ দিনে ডেলিভারি।');
        await page.keyboard.press('ControlOrMeta+a');
        await page.getByRole('button', { name: 'বোল্ড' }).first().click();
        await page.getByLabel('টাইটেল', { exact: true }).nth(1).fill('Delivery information');
        await page.getByLabel('ওয়েব ঠিকানা').nth(1).fill(`delivery-info-${suffix}`);
        await page.getByRole('button', { name: 'পরিবর্তন সেভ করুন' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'পেজ সেভ হয়েছে' })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/store\/pages\/\d+$/);

        const response = await page.request.get(`${SITE}/delivery-${suffix}/`);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain('ডেলিভারির তথ্য');
        expect(html).toMatch(/<(b|strong)>ঢাকার ভেতরে ১ দিনে ডেলিভারি।<\/(b|strong)>/);

        // A web address the website itself uses is refused, in Bangla.
        await page.getByLabel('ওয়েব ঠিকানা').first().fill('cart');
        await page.getByRole('button', { name: 'পরিবর্তন সেভ করুন' }).click();
        await expect(
            page.getByText('এই ঠিকানাটি ওয়েবসাইট নিজে ব্যবহার করে। অন্য ঠিকানা দিন।'),
        ).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('adds a header menu link to a category', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough: both projects share the menus');
        // Its own category, so the test doesn't depend on others having run first (CI starts empty).
        const admin = await adminSession();
        const { collections } = await admin.query(
            '{ collections(options: { filter: { slug: { eq: "playwright-menu-category" } } }) { items { id } } }',
        );
        if (!collections.items.length) {
            await admin.query(`mutation { createCollection(input: { filters: [], translations: [
                { languageCode: en, name: "Playwright menu category", slug: "playwright-menu-category", description: "" }
            ] }) { id } }`);
        }
        await signIn(page, 'en');
        await page.goto('/admin/store/menus');
        await expect(page.getByRole('heading', { name: 'Menus', exact: true })).toBeVisible();
        const label = `Sale ${Date.now() % 100000}`;
        const header = page.getByRole('region', { name: 'Header menu' });
        await header.getByRole('button', { name: 'Add a link', exact: true }).click();
        await header.getByLabel('Name in English').last().fill(label);
        await header.getByLabel('Name in Bangla').last().fill('ছাড়');
        // A new link opens a category.
        await header.getByLabel('A category').last().selectOption({ label: 'Playwright menu category' });
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Menus saved.' })).toBeVisible();

        // The storefront caches menus for a short while (CACHE_TTL_SECONDS).
        await expect
            .poll(async () => (await (await fetch(`${SITE}/en/`)).text()).includes(`>${label}</a>`), {
                timeout: 70_000,
            })
            .toBe(true);

        // Clean up: remove the link again.
        await header.getByRole('button', { name: 'Remove' }).last().click();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Menus saved.' }).last()).toBeVisible();
    });
});

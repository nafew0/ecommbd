import { expect, type Page, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { signIn, watchForErrors } from './support/admin-ui';

/**
 * Image uploads in the merchant admin (roadmap phase 09), through the store logo: upload progress,
 * then clear Bangla/English messages for iPhone HEIC photos and for files the server refuses.
 */

const HEIC = fs.readFileSync(path.join(__dirname, '../../apps/core/test/fixtures/images/photo.heic'));

async function openStoreSettings(page: Page, language: 'bn' | 'en') {
    await signIn(page, language);
    await page.goto('/admin/settings/store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
        language === 'bn' ? 'স্টোর সেটিংস' : 'Store settings',
    );
}

/** The logo's file input (the first image upload on the page). */
const logoInput = (page: Page) => page.locator('input[type="file"]').first();

test.describe('image uploads', () => {
    test('shows progress, then the uploaded logo', async ({ page }) => {
        const errors = watchForErrors(page);
        await openStoreSettings(page, 'en');
        // Hold the upload for a moment, so the progress bar can be seen.
        await page.route('**/admin-api**', async route => {
            if (route.request().headers()['content-type']?.startsWith('multipart/form-data')) {
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            await route.continue();
        });
        const logo = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#0f766e' } })
            .png()
            .toBuffer();
        await logoInput(page).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
        await expect(page.getByRole('progressbar')).toBeVisible();
        await expect(page.locator('img[src*="preview"]').first()).toBeVisible();
        await expect(page.getByRole('progressbar')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('explains that iPhone HEIC photos need to be JPG or PNG, in Bangla', async ({ page }) => {
        await openStoreSettings(page, 'bn');
        let uploads = 0;
        page.on('request', request => {
            if (request.headers()['content-type']?.startsWith('multipart/form-data')) uploads++;
        });
        await logoInput(page).setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: HEIC });
        await expect(page.getByRole('alert')).toContainText('JPG বা PNG ছবি দিন। iPhone-এর HEIC ছবি');
        expect(uploads).toBe(0);
    });

    test('shows the server’s reason when it refuses a picture', async ({ page }) => {
        await openStoreSettings(page, 'en');
        // 50 megapixels in about 150 KB: passes the size check here, refused by the server.
        const bomb = await sharp({ create: { width: 8000, height: 6250, channels: 3, background: '#fff' } })
            .png({ compressionLevel: 9 })
            .toBuffer();
        await logoInput(page).setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: bomb });
        await expect(page.getByRole('alert')).toHaveText(
            'This image has too many pixels (over 40 megapixels). Please make it smaller and try again.',
        );
        const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c33' } })
            .jpeg()
            .toBuffer();
        const truncated = photo.subarray(0, Math.floor(photo.byteLength / 2));
        await logoInput(page).setInputFiles({ name: 'half.jpg', mimeType: 'image/jpeg', buffer: truncated });
        await expect(page.getByRole('alert')).toHaveText(
            'This image file is damaged or incomplete. Please try another file.',
        );
    });
});

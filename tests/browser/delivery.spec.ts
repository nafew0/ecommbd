import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, type ApiSession } from './support/store-api';

/** Settings → Delivery in the merchant admin (roadmap phase 07), on a desktop and a phone. */

let admin: ApiSession;
let original: unknown;

test.beforeAll(async () => {
    admin = await adminSession();
    ({ bdShippingSettings: original } = await admin.query('{ bdShippingSettings }'));
});

test.afterAll(async () => {
    await admin.query(
        'mutation ($input: JSON!) { updateBdShippingSettings(input: $input) { errors { path } } }',
        { input: original },
    );
});

test('edits delivery charges in Bangla: Bangla digits, free delivery, saved', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    await signIn(page, 'bn');
    await page.goto('/admin/settings/delivery');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ডেলিভারি চার্জ');

    // The coverage checkbox has the same label, so pick the text box.
    const city = page.getByRole('textbox', { name: 'ঢাকা সিটির ভেতরে', exact: true });
    await expect(city).toHaveValue('৬০');
    await city.fill('৭০');
    await city.blur();
    await expect(city).toHaveValue('৭০');
    await page.getByText('ফ্রি ডেলিভারি: ঢাকা সিটির ভেতরে').click();
    await expect(page.getByLabel('যত টাকা থেকে ফ্রি')).toHaveValue('২,০০০');
    await page.getByRole('button', { name: 'পরিবর্তন সেভ করুন' }).click();
    await expect(page.getByText('ডেলিভারি চার্জ সেভ হয়েছে।')).toBeVisible();

    const { bdShippingSettings } = await admin.query('{ bdShippingSettings }');
    expect(bdShippingSettings).toMatchObject({
        confirmed: true,
        standard: { rates: { dhaka_city: 7000 } },
        freeAbove: { dhaka_city: 200000 },
    });
    // No sideways scrolling on a phone.
    if (testInfo.project.name === 'phone') {
        const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(width).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
});

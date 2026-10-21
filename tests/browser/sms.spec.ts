import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, type ApiSession } from './support/store-api';

/** Settings → SMS in the merchant admin (roadmap phase 10), on a desktop and a phone. */

let admin: ApiSession;
let original: unknown;

test.beforeAll(async () => {
    admin = await adminSession();
    ({ bdSmsSettings: original } = await admin.query('{ bdSmsSettings }'));
});

test.afterAll(async () => {
    await admin.query('mutation ($input: JSON!) { updateBdSmsSettings(input: $input) { errors { path } } }', {
        input: original,
    });
});

test('edits an SMS template in Bangla: live length and cost, saved', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    await signIn(page, 'bn');
    await page.goto('/admin/settings/sms');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('এসএমএস');
    // Development records SMS instead of sending them, and says so.
    await expect(page.getByText(/এখনো কোনো এসএমএস প্রোভাইডার যুক্ত নেই/)).toBeVisible();

    const template = page.getByLabel('অর্ডার পাওয়া গেছে: বাংলা');
    await template.fill('ধন্যবাদ {name}, অর্ডার #{orderNumber}');
    // One Bangla SMS part at the default ৳0.35 a part.
    await expect(page.getByText(/১টি এসএমএস · প্রায় ৳০\.৩৫/).first()).toBeVisible();
    await page.getByRole('button', { name: 'পরিবর্তন সেভ করুন' }).click();
    await expect(page.getByText('এসএমএস সেটিংস সেভ হয়েছে।')).toBeVisible();

    const { bdSmsSettings } = await admin.query('{ bdSmsSettings }');
    expect(bdSmsSettings).toMatchObject({
        events: { placed: { enabled: true, bn: 'ধন্যবাদ {name}, অর্ডার #{orderNumber}' } },
    });
    // No sideways scrolling on a phone.
    if (testInfo.project.name === 'phone') {
        const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(width).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
});

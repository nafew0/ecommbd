import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import {
    adminSession,
    type ApiSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from './support/store-api';

/** Orders → Verify payments in the merchant admin (roadmap phase 08), on a desktop and a phone. */

let admin: ApiSession;
let variantId: string;
let original: unknown;

const randomTrx = () => `PW${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

test.beforeAll(async () => {
    admin = await adminSession();
    variantId = await ensureCheckoutFixtures(admin);
    ({ bdPaymentSettings: original } = await admin.query('{ bdPaymentSettings }'));
    const settings = original as { mfs: Record<string, unknown> };
    await admin.query(
        'mutation ($input: JSON!) { updateBdPaymentSettings(input: $input) { errors { path } } }',
        {
            input: {
                ...settings,
                mfs: {
                    ...settings.mfs,
                    bkash: { enabled: true, number: '01812345678', accountType: 'personal' },
                },
            },
        },
    );
});

test.afterAll(async () => {
    await admin.query(
        'mutation ($input: JSON!) { updateBdPaymentSettings(input: $input) { errors { path } } }',
        {
            input: original,
        },
    );
});

test('verifies a bKash payment from the queue, in Bangla', async ({ page }) => {
    const errors = watchForErrors(page);
    const transactionId = randomTrx();
    const code = await placePhoneOrder({
        variantId,
        name: 'PW bKash',
        phone: randomPhone(),
        payment: { method: 'bd-bkash', metadata: { senderNumber: '01912345678', transactionId } },
    });

    await signIn(page, 'bn');
    await page.goto('/admin/orders/payments');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('পেমেন্ট যাচাই');
    const card = page.getByRole('listitem').filter({ hasText: transactionId });
    await expect(card).toContainText('বিকাশ');
    await expect(card).toContainText('01912-345678');
    await card.getByRole('button', { name: 'যাচাই করুন' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('স্টেটমেন্টে যত টাকা')).toHaveValue('১,৩১০');
    await dialog.getByRole('button', { name: 'যাচাই করুন' }).click();
    await expect(page.getByText('পেমেন্ট যাচাই হয়েছে।')).toBeVisible();
    await expect(card).toHaveCount(0);

    const { orders } = await admin.query(
        'query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items { bd { paymentType paidAmount codDue } } } }',
        { code },
    );
    expect(orders.items[0].bd).toEqual({ paymentType: 'prepaid', paidAmount: 131000, codDue: 0 });
    expect(errors).toEqual([]);
});

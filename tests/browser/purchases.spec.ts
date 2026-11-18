import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, ensureCheckoutFixtures } from './support/store-api';

/** Purchases (phase 52), in Bangla: receiving stock shows on the purchase. */
test('receives a purchase in Bangla', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const admin = await adminSession();
    const variantId = await ensureCheckoutFixtures(admin);
    const { createBdSupplier } = await admin.query(
        `mutation ($input: JSON!) {
            createBdSupplier(input: $input) { supplier { id } errors { path } }
        }`,
        { input: { name: 'PW সাপ্লায়ার', phone: '', address: '', note: '' } },
    );
    const supplierId = createBdSupplier.supplier.id as string;
    const { createBdPurchase } = await admin.query(
        `mutation ($input: JSON!) {
            createBdPurchase(input: $input) { purchase { id lines { id } } errors { path } }
        }`,
        {
            input: {
                supplierId,
                purchasedOn: '2026-11-16',
                note: '',
                delivery: 0,
                other: 0,
                discount: 0,
                paid: 0,
                lines: [{ id: null, variantId, quantity: 2, unitCost: 15000 }],
            },
        },
    );
    const purchase = createBdPurchase.purchase as { id: string; lines: Array<{ id: string }> };
    await admin.query(`mutation ($id: ID!) { markBdPurchaseOrdered(id: $id) { id } }`, { id: purchase.id });
    await admin.query(
        `mutation ($id: ID!, $input: JSON!) { receiveBdPurchase(id: $id, input: $input) { id } }`,
        { id: purchase.id, input: { note: '', lines: [{ lineId: purchase.lines[0]!.id, quantity: 2 }] } },
    );

    await signIn(page, 'bn');
    await page.goto(`/admin/products/purchases/${purchase.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('মাল এসেছে').first()).toBeVisible();
    await expect(page.getByText('PW সাপ্লায়ার')).toBeVisible();
    await page.goto(`/admin/products/suppliers/${supplierId}`);
    await expect(page.getByRole('heading', { name: 'PW সাপ্লায়ার' })).toBeVisible();
    await expect(page.getByText('বাকি').first()).toBeVisible();
    await page.screenshot({ path: `test-results/purchases-${testInfo.project.name}.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]);
});

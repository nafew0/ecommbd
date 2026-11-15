import { expect, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import {
    adminSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from './support/store-api';

/**
 * Cost and profit (phase 51), in Bangla: an order with a known cost shows the breakdown (never
 * "অজানা" or ৳০ for that cost), the product and order lists show the columns, and the settings
 * page uses the same settings layout as the other screens.
 */

test('shows an order’s profit in Bangla, with cost on the product and the settings page', async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const admin = await adminSession();
    const variantId = await ensureCheckoutFixtures(admin);
    await admin.query(
        `mutation ($id: ID!, $cost: Int) {
            updateProductVariants(input: [{ id: $id, customFields: { unitCost: $cost } }]) { id }
        }`,
        { id: variantId, cost: 40000 },
    );
    await admin.query(
        `mutation ($input: JSON!) {
            updateBdCostSettings(input: $input) { errors { path } }
        }`,
        {
            input: {
                courierFlat: 6000,
                codCharge: { type: 'flat', flat: 0, percent: null },
                gatewayFeePercent: 0,
            },
        },
    );
    const code = await placePhoneOrder({
        variantId,
        name: 'PW ক্রয়মূল্য',
        phone: randomPhone(),
    });
    const { orders } = await admin.query(
        'query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items { id customFields { orderNumber } } } }',
        { code },
    );
    const order = orders.items[0];

    const { productVariant } = await admin.query(
        'query ($id: ID!) { productVariant(id: $id) { productId } }',
        { id: variantId },
    );

    await signIn(page, 'bn');
    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'লাভ' })).toBeVisible();
    await expect(page.getByText('পণ্যের ক্রয়মূল্য')).toBeVisible();
    await expect(page.getByText('৳৪০০').first()).toBeVisible();
    await expect(page.getByText('কুরিয়ার চার্জ')).toBeVisible();
    await expect(page.getByText('অজানা')).toHaveCount(0);
    await page.screenshot({
        path: `test-results/cost-order-${testInfo.project.name}.png`,
        fullPage: true,
    });

    if (testInfo.project.name === 'desktop') {
        await page.goto('/admin/orders');
        await expect(page.getByRole('columnheader', { name: 'লাভ' })).toBeVisible();
        await expect(page.getByText('PW ক্রয়মূল্য').first()).toBeVisible();
        await page.screenshot({ path: 'test-results/cost-orders-desktop.png', fullPage: true });
        await page.goto('/admin/products');
        await expect(page.getByRole('columnheader', { name: 'ক্রয়মূল্য' })).toBeVisible();
        await expect(page.getByText('Playwright panjabi')).toBeVisible();
        await expect(page.getByText('৬৮% মার্জিন').first()).toBeVisible();
        await page.screenshot({ path: 'test-results/cost-products-desktop.png', fullPage: true });
    }

    await page.goto(`/admin/products/${productVariant.productId}`);
    await expect(page.getByText('ক্রয়মূল্য').first()).toBeVisible();
    await page.screenshot({
        path: `test-results/cost-product-${testInfo.project.name}.png`,
        fullPage: true,
    });

    await page.goto('/admin/settings/cost');
    await expect(page.getByRole('heading', { name: 'ক্রয়মূল্য ও লাভ' })).toBeVisible();
    await expect(page.getByText('কুরিয়ার না বললে')).toBeVisible();
    await page.screenshot({
        path: `test-results/cost-settings-${testInfo.project.name}.png`,
        fullPage: true,
    });
    expect(errors, errors.join('\n')).toEqual([]);
});

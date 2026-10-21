import { expect, type Page, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import {
    adminSession,
    type ApiSession,
    ensureCheckoutFixtures,
    placePhoneOrder,
    randomPhone,
} from './support/store-api';

/**
 * The confirmation queue and order screens in the merchant admin (roadmap phase 04): confirm,
 * cancel with a reason, no answer, call later and the "… is calling" claim, on a desktop and a phone.
 */

const KARIM = { email: 'karim.playwright@example.com', password: 'karim-playwright-123' };
const toBangla = (text: string) => text.replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'.charAt(Number(digit)));

let admin: ApiSession;
let variantId: string;

/** A New order from a shopper named "PW …"; returns its order number. */
async function newOrder(name: string): Promise<string> {
    const code = await placePhoneOrder({ variantId, name: `PW ${name}`, phone: randomPhone() });
    const { orders } = await admin.query(
        'query ($code: String!) { orders(options: { filter: { code: { eq: $code } } }) { items { customFields { orderNumber } } } }',
        { code },
    );
    return orders.items[0].customFields.orderNumber as string;
}

async function statusOf(number: string) {
    const { bdOrders } = await admin.query(
        'query ($search: String) { bdOrders(search: $search) { items { customFields { orderNumber } bd { status cancelReason callAttempts } } } }',
        { search: `#${number}` },
    );
    return bdOrders.items.find(
        (item: { customFields: { orderNumber: string } }) => item.customFields.orderNumber === number,
    )?.bd;
}

function card(page: Page, number: string, bangla = false) {
    return page.getByRole('listitem').filter({ hasText: `#${bangla ? toBangla(number) : number}` });
}

test.beforeAll(async () => {
    admin = await adminSession();
    variantId = await ensureCheckoutFixtures(admin);
    // Earlier runs' test orders leave the queue, so this run's are on the first page.
    const { bdConfirmationQueue } = await admin.query(
        '{ bdConfirmationQueue(take: 100) { items { id shippingAddress { fullName } } } }',
    );
    for (const order of bdConfirmationQueue.items) {
        if (order.shippingAddress?.fullName?.startsWith('PW ')) {
            await admin.query(
                'mutation ($id: ID!) { cancelBdOrder(input: { orderId: $id, reason: "other", note: "Browser test cleanup" }) { __typename } }',
                { id: order.id },
            );
        }
    }
    // A second staff member, to show the claim.
    const { administrators } = await admin.query(
        'query ($email: String!) { administrators(options: { filter: { emailAddress: { eq: $email } } }) { totalItems } }',
        { email: KARIM.email },
    );
    if (!administrators.totalItems) {
        const { roles } = await admin.query('{ roles(options: { take: 50 }) { items { id code } } }');
        const role = roles.items.find((item: { code: string }) => item.code === 'order-staff');
        await admin.query(
            `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
            {
                input: {
                    firstName: 'Karim',
                    lastName: 'Staff',
                    emailAddress: KARIM.email,
                    password: KARIM.password,
                    roleIds: [role.id],
                },
            },
        );
    }
});

test.describe('confirmation queue', () => {
    test('confirms an order in two clicks, in Bangla', async ({ page }) => {
        const errors = watchForErrors(page);
        const number = await newOrder('Confirm');
        await signIn(page, 'bn');
        await page.goto('/admin/orders/confirm');
        await expect(page.getByRole('heading', { name: 'অর্ডার কনফার্ম' })).toBeVisible();
        const row = card(page, number, true);
        await expect(row).toContainText('PW Confirm');
        await expect(row.getByRole('link', { name: /0171/ })).toHaveAttribute('href', /^tel:\+8801/);
        await row.getByRole('button', { name: 'কনফার্ম করুন' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'অর্ডার কনফার্ম হয়েছে।' })).toBeVisible();
        await expect(row).toHaveCount(0);
        expect((await statusOf(number)).status).toBe('confirmed');
        expect(errors).toEqual([]);
    });

    test('cancels with a reason', async ({ page }) => {
        const number = await newOrder('Cancel');
        await signIn(page, 'en');
        await page.goto('/admin/orders/confirm');
        await card(page, number).getByRole('button', { name: 'Cancel order' }).click();
        const dialog = page.getByRole('dialog', { name: `Cancel order #${number}?` });
        await expect(dialog.getByRole('button', { name: 'Cancel order' })).toBeDisabled();
        await dialog.getByLabel('Why is it cancelled?').selectOption('fake');
        await dialog.getByRole('button', { name: 'Cancel order' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Order cancelled.' })).toBeVisible();
        expect(await statusOf(number)).toMatchObject({ status: 'cancelled', cancelReason: 'fake' });
    });

    test('records "no answer" and "call later"', async ({ page }) => {
        const unanswered = await newOrder('No answer');
        const later = await newOrder('Call later');
        await signIn(page, 'en');
        await page.goto('/admin/orders/confirm');
        await card(page, unanswered).getByRole('button', { name: 'No answer' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Moved down the queue.' })).toBeVisible();
        await expect(card(page, unanswered)).toContainText('1 unanswered call');
        expect((await statusOf(unanswered)).callAttempts).toBe(1);

        await card(page, later).getByRole('button', { name: 'Call later' }).click();
        const dialog = page.getByRole('dialog', { name: 'Call later' });
        await dialog.getByRole('button', { name: 'In 1 hour' }).click();
        await dialog.getByRole('button', { name: 'Call later' }).click();
        await expect(
            page.getByRole('status').filter({ hasText: 'It comes back to the queue at that time.' }),
        ).toBeVisible();
        await expect(card(page, later)).toHaveCount(0);
        await page.getByRole('tab', { name: /Call later/ }).click();
        await expect(card(page, later)).toContainText('Call at');
    });

    test('shows "Karim Staff is calling" when another staff member has the order open', async ({ page }) => {
        const number = await newOrder('Claimed');
        const { bdOrders } = await admin.query(
            'query ($search: String) { bdOrders(search: $search) { items { id } } }',
            { search: `#${number}` },
        );
        const karim = await adminSession(KARIM.email, KARIM.password);
        await karim.query('mutation ($id: ID!) { claimBdOrder(orderId: $id) { __typename } }', {
            id: bdOrders.items[0].id,
        });
        await signIn(page, 'en');
        await page.goto('/admin/orders/confirm');
        await expect(card(page, number)).toContainText('Karim Staff is calling');
    });
});

test.describe('orders', () => {
    test('explains a status-only return and requires confirmation', async ({ page }) => {
        const number = await newOrder('Return boundary');
        await signIn(page, 'en');
        await page.goto('/admin/orders');
        await page.getByRole('searchbox').fill(`#${number}`);
        await page.getByRole('link', { name: `#${number}`, exact: true }).click();
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.getByRole('button', { name: 'Mark packed', exact: true }).click();
        await page.getByRole('button', { name: 'Mark shipped', exact: true }).click();
        await page.getByRole('button', { name: 'Mark returned', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Record the parcel as returned?' });
        await expect(dialog.getByText(/Returned quantities, stock and payments are unchanged/)).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Mark returned', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Mark returned', exact: true }).click();
        await dialog.getByRole('button', { name: 'Mark returned', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText(/Returned quantities, stock and payments are unchanged/)).toBeVisible();
        await expect(page.getByText('To collect on delivery', { exact: true })).toHaveCount(0);
    });

    test('lists orders with status tabs and opens one', async ({ page }) => {
        const number = await newOrder('List');
        await signIn(page, 'en');
        await page.goto('/admin/orders');
        await expect(page.getByRole('tab', { name: /New/ })).toBeVisible();
        await page.getByRole('searchbox').fill(`#${number}`);
        const row = page.getByRole('row').filter({ hasText: `#${number}` });
        await expect(row).toContainText('New');
        await row.getByRole('link', { name: `#${number}` }).click();
        await expect(page.getByRole('heading', { name: `#${number}` })).toBeVisible();
        await expect(page.getByText('To collect on delivery')).toBeVisible();
        await expect(page.getByText('You are calling')).toBeVisible();
        await page.getByRole('button', { name: 'Confirm' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Order confirmed.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Mark packed' })).toBeVisible();
        await expect(page.getByText(/Status: Confirmed · by Super Admin/)).toBeVisible();
    });

    test('fits a phone screen, with no sideways scrolling, in Bangla', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Phone layout');
        await newOrder('Phone layout with a rather long customer name to wrap');
        await signIn(page, 'bn');
        const sidewaysScroll = () =>
            page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        for (const path of ['/admin/orders/confirm', '/admin/orders', '/admin/', '/admin/settings/orders']) {
            await page.goto(path);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await page.waitForLoadState('networkidle');
            expect(await sidewaysScroll(), path).toBe(false);
        }
    });

    test('shows today’s numbers on the home page', async ({ page }) => {
        await signIn(page, 'en');
        await expect(page.getByText('Orders today')).toBeVisible();
        await expect(page.getByText('Order value today', { exact: true })).toBeVisible();
        await expect(page.getByText(/Not money received/)).toBeVisible();
        await expect(page.getByText('Sales today', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Waiting for confirmation')).toBeVisible();
        await expect(page.getByText(/Bangladesh time, \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    });
});

import {
    createNode,
    createSection,
    defaultSystemLayout,
    type LayoutDocument,
    PAGE_CONTENT,
    type SectionData,
    SYSTEM_LAYOUTS,
} from '@ecommbd/sections';
import { expect, type Page, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { publishLayout, setDraft, waitForStorefront } from './support/sections';
import { adminSession, type ApiSession, ensureCheckoutFixtures } from './support/store-api';

/**
 * System pages in the builder (roadmap phase 60): the merchant's sections around the header, the
 * footer, the product, the product list, the cart, the checkout form and the receipt; a header
 * built from elements alone; and the editor, where each page's own part is a locked block.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const PREVIEW = 'Preview of the page';
const preview = (page: Page) => page.frameLocator(`iframe[title="${PREVIEW}"]`);

let admin: ApiSession;
const run = Math.random().toString(36).slice(2, 8);

/** A free section holding one line of text. */
function note(words: string): SectionData {
    const section = createSection('custom');
    section.children = [createNode('heading', { text: { bn: words, en: words }, tag: 'h2' })];
    return section;
}

/** A layout with a line above and a line below the page's own part. */
function around(name: string): LayoutDocument {
    return {
        sections: [note(`${name} above ${run}`), createSection(PAGE_CONTENT), note(`${name} below ${run}`)],
    };
}

/** True when `first` comes before `second` on the page. */
async function inOrder(page: Page, first: string, second: string) {
    const a = await page.locator(first).first().elementHandle();
    const b = await page.locator(second).first().elementHandle();
    if (!a || !b) return false;
    return page.evaluate(
        ([one, two]) => !!(one!.compareDocumentPosition(two!) & Node.DOCUMENT_POSITION_FOLLOWING),
        [a, b],
    );
}

const line = (page: Page, words: string) => page.getByRole('heading', { name: words });

test.describe('system pages', () => {
    test.beforeAll(async () => {
        admin = await adminSession();
        await ensureCheckoutFixtures(admin);
    });

    test.afterAll(async () => {
        // `KEEP_SYSTEM_LAYOUTS=1` leaves them, to run the checkout tests with a custom layout.
        if (process.env.KEEP_SYSTEM_LAYOUTS) return;
        for (const type of SYSTEM_LAYOUTS) await publishLayout(admin, type, defaultSystemLayout());
    });

    test('sections sit above and below the header, footer, product, product list, cart and receipt', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Once is enough');
        const errors = watchForErrors(page);
        for (const type of SYSTEM_LAYOUTS) await publishLayout(admin, type, around(type));
        await waitForStorefront(`${SITE}/en/`, html => html.includes(`footer below ${run}`));

        // The header and footer, on every page.
        await page.goto(`${SITE}/en/`);
        for (const [type, own] of [
            ['header', '.site-header'],
            ['footer', '.site-footer'],
        ] as const) {
            await expect(line(page, `${type} above ${run}`)).toBeVisible();
            expect(await inOrder(page, `text=${type} above ${run}`, own)).toBe(true);
            expect(await inOrder(page, own, `text=${type} below ${run}`)).toBe(true);
        }
        expect(await inOrder(page, `text=header below ${run}`, 'main')).toBe(true);
        expect(await inOrder(page, 'main', `text=footer above ${run}`)).toBe(true);

        // The product list: search, and so categories and brands.
        await page.goto(`${SITE}/en/search/`);
        expect(await inOrder(page, `text=listing above ${run}`, '.page-header')).toBe(true);
        expect(await inOrder(page, '.page-header', `text=listing below ${run}`)).toBe(true);

        // A product, then its button still puts it in the cart, which has its own lines too.
        await page.goto(`${SITE}/en/product/playwright-panjabi/`);
        expect(await inOrder(page, `text=product above ${run}`, 'article.product')).toBe(true);
        expect(await inOrder(page, 'article.product', `text=product below ${run}`)).toBe(true);
        await page.getByRole('button', { name: 'Buy now' }).click();

        // Buy now goes straight to the checkout: the form, between the merchant's lines.
        await expect(page).toHaveURL(/\/checkout\/$/);
        expect(await inOrder(page, `text=checkout above ${run}`, 'form[data-checkout-form], main form')).toBe(
            true,
        );
        await expect(line(page, `checkout below ${run}`)).toBeVisible();

        await page.goto(`${SITE}/en/cart/`);
        expect(await inOrder(page, `text=cart above ${run}`, '[data-cart]')).toBe(true);
        expect(await inOrder(page, '[data-cart]', `text=cart below ${run}`)).toBe(true);
        await expect(page.locator('[data-cart]')).toContainText('Playwright panjabi');

        await page.goto(`${SITE}/en/checkout/thank-you/`);
        expect(await inOrder(page, `text=thanks above ${run}`, '.thank-you')).toBe(true);
        expect(await inOrder(page, '.thank-you', `text=thanks below ${run}`)).toBe(true);

        // Nothing sticks out of a phone on any of them.
        await page.setViewportSize({ width: 360, height: 780 });
        for (const path of ['/en/', '/en/search/', '/en/cart/', '/en/product/playwright-panjabi/']) {
            await page.goto(`${SITE}${path}`);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        }
        expect(errors).toEqual([]);
    });

    test('a header built from elements alone replaces the store’s own', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Once is enough');
        const section = createSection('custom');
        const row = createNode('container', { direction: 'row', gap: 16, stack: false });
        row.children = [createNode('store-logo'), createNode('search-box'), createNode('cart-link')];
        section.children = [row];
        const marker = `own${run}`;
        section.style.anchor = marker;
        await publishLayout(admin, 'header', { sections: [section] });
        await waitForStorefront(`${SITE}/en/`, html => html.includes(`id="${marker}"`));
        await page.goto(`${SITE}/en/`);
        await expect(page.locator('.site-header')).toHaveCount(0);
        await expect(page.locator('.area-header .store-logo')).toBeVisible();
        // Its search box searches.
        await page.locator('.area-header .search-inline input').fill('panjabi');
        await page.locator('.area-header .search-inline input').press('Enter');
        await expect(page).toHaveURL(/\/search\/\?q=panjabi/);
        await expect(page.locator('.area-header .store-logo')).toBeVisible();
        await publishLayout(admin, 'header', defaultSystemLayout());
    });

    test('the editor opens each shop page with its own part as a locked block', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The editor on a phone has its own test');
        const errors = watchForErrors(page);
        page.setDefaultTimeout(8000);
        await setDraft(admin, 'checkout', defaultSystemLayout());
        await signIn(page, 'en');
        await page.goto('/admin/store');
        await expect(page.getByRole('heading', { name: 'Shop pages' })).toBeVisible();
        await page.getByRole('link', { name: /^Checkout/ }).click();
        await expect(page).toHaveURL(/\/store\/design\/checkout$/);

        // The block is named for this page, explains itself, and can't be copied.
        const list = page.getByRole('list', { name: 'Sections' });
        await list
            .getByRole('button', { name: /^Checkout form/ })
            .first()
            .click();
        await expect(page.getByText('They can’t be changed or reordered.')).toBeVisible();
        // The frame's cart is empty: a box stands where the form goes.
        await expect(preview(page).getByText('The checkout form shows here')).toBeVisible({
            timeout: 15_000,
        });

        // Without the block the page can't be published, and the checklist says why.
        await page.getByRole('button', { name: 'Actions for Checkout form' }).click();
        await page.getByRole('menuitem', { name: 'Remove' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('This page needs its own block')).toBeVisible();
        await page.keyboard.press('Escape');
        // Nothing went live.
        const { bdPageLayout } = await admin.query('{ bdPageLayout(type: "checkout") { hasChanges } }');
        expect(bdPageLayout.hasChanges).toBe(true);
        expect(errors).toEqual([]);
        await setDraft(admin, 'checkout', defaultSystemLayout());
    });
});

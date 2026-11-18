import {
    createNode,
    createSection,
    createStructure,
    type LayoutDocument,
    type NodeData,
    STRUCTURE_PRESETS,
} from '@ecommbd/sections';
import { expect, type Page, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { publishLayout, resetHome, setDraft, waitForStorefront } from './support/sections';
import { adminSession, type ApiSession } from './support/store-api';

/**
 * The element tree (roadmap phase 56): a three-level nested layout as shoppers see it on a
 * phone, a tablet and a computer, and the editor's tree: adding a layout and elements inside it,
 * changing an element's look for phones only, the nesting limit, and opening a ready-made
 * section up into elements.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const PREVIEW = 'Preview of the page';

let admin: ApiSession;

const text = (en: string, bn = en) => ({ bn, en });
const preview = (page: Page) => page.frameLocator(`iframe[title="${PREVIEW}"]`);

/** A wide column beside a narrow one; in the wide one, a heading above a row of two buttons. */
function nestedPage(): { document: LayoutDocument; ids: Record<string, string> } {
    const section = createSection('custom');
    const grid = createStructure(STRUCTURE_PRESETS.find(preset => preset.key === 'grid-2-1')!);
    const [wide, narrow] = grid.children as [NodeData, NodeData];
    const heading = createNode('heading', { text: text('Three levels deep', 'তিন ধাপ গভীর') });
    heading.style = {
        base: { color: '#0b3d2e', fontSize: 40 },
        tablet: { fontSize: 30 },
        phone: { fontSize: 22, textAlign: 'center' },
    };
    const row = createNode('container', { direction: 'row', gap: 12, stack: false });
    row.children = [
        createNode('button', { label: text('Shop now', 'এখনই কিনুন'), link: { type: 'search' } }),
        createNode('button', {
            label: text('Call us', 'কল করুন'),
            link: { type: 'search' },
            look: 'outline',
        }),
    ];
    wide.children = [heading, row];
    narrow.children = [
        createNode('icon-list', {
            items: text('Cash on delivery\nEasy returns', 'ক্যাশ অন ডেলিভারি\nসহজ রিটার্ন'),
        }),
    ];
    // An empty container and a hidden element: shoppers see neither.
    const empty = createNode('container');
    const hidden = { ...createNode('heading', { text: text('Hidden words') }), hidden: true };
    section.children = [grid, empty, hidden];
    return {
        document: { sections: [section] },
        ids: {
            section: section.uid,
            grid: grid.uid,
            wide: wide.uid,
            narrow: narrow.uid,
            row: row.uid,
            heading: heading.uid,
            empty: empty.uid,
        },
    };
}

async function openEditor(page: Page) {
    await page.goto('/admin/store/design/home');
    await expect(preview(page).locator('body[data-preview="editor"]')).toBeAttached({ timeout: 15_000 });
}

/** Opens the picker under the nth container and picks from it (once a closing picker has gone). */
async function addInside(page: Page, index: number, name: string) {
    await page.getByRole('button', { name: 'Add inside' }).nth(index).click();
    const option = page.getByRole('button', { name, exact: true });
    await expect(option).toHaveCount(1);
    await option.click();
}

test.describe('the element tree', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        admin = await adminSession();
    });

    test.afterAll(async () => {
        await resetHome(admin);
    });

    test('a three-level layout stacks on phones, sits side by side on tablets and computers, with no script', async ({
        browser,
        isMobile,
    }) => {
        test.skip(isMobile, 'Sizes are set here');
        const { document, ids } = nestedPage();
        await publishLayout(admin, 'home', document);
        const html = await waitForStorefront(`${SITE}/en/`, body => body.includes('Three levels deep'));
        // Plain HTML and CSS: nothing in the section runs, and nothing hidden or empty is sent.
        const sectionHtml = html.slice(
            html.indexOf('section-custom'),
            html.indexOf('</section>', html.indexOf('section-custom')),
        );
        expect(sectionHtml).not.toContain('<script');
        expect(sectionHtml).not.toContain('style=');
        expect(html).not.toContain('Hidden words');
        expect(html).not.toContain(ids.empty);

        const box = async (page: Page, uid: string) =>
            (await page.locator(`[data-u="${uid}"]`).boundingBox())!;
        for (const [width, size] of [
            [1280, '40px'],
            [768, '30px'],
            [360, '22px'],
        ] as const) {
            const context = await browser.newContext({ viewport: { width, height: 800 } });
            const page = await context.newPage();
            await page.goto(`${SITE}/en/`);
            const [wide, narrow, row, first, second] = await Promise.all([
                box(page, ids.wide),
                box(page, ids.narrow),
                box(page, ids.row),
                page.locator(`[data-u="${ids.row}"] > .el`).nth(0).boundingBox(),
                page.locator(`[data-u="${ids.row}"] > .el`).nth(1).boundingBox(),
            ]);
            if (width === 360) {
                // One column: the narrow one below the wide one, both the full width.
                expect(narrow.y).toBeGreaterThan(wide.y + wide.height - 1);
                expect(Math.abs(wide.width - narrow.width)).toBeLessThan(1);
            } else {
                // Side by side, two to one.
                expect(Math.abs(wide.y - narrow.y)).toBeLessThan(1);
                expect(narrow.x).toBeGreaterThan(wide.x + wide.width - 1);
                expect(wide.width / narrow.width).toBeGreaterThan(1.8);
                expect(wide.width / narrow.width).toBeLessThan(2.2);
            }
            // The third level: the buttons stay in a row at every size (this row doesn't stack).
            expect(row.y).toBeGreaterThan(wide.y);
            expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
            expect(second!.x).toBeGreaterThan(first!.x + first!.width);
            // Each device's own type size, and nothing wider than the screen.
            await expect(page.locator(`[data-u="${ids.heading}"]`)).toHaveCSS('font-size', size);
            await expect(page.locator(`[data-u="${ids.heading}"]`)).toHaveCSS(
                'text-align',
                width === 360 ? 'center' : 'start',
            );
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
                width,
            );
            await context.close();
        }
    });

    test('a merchant adds a layout and elements in the tree, and styles one for phones only', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        test.setTimeout(90_000);
        const errors = watchForErrors(page);
        const section = createSection('custom');
        section.children = [];
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        await openEditor(page);
        await page
            .getByRole('list', { name: 'Sections' })
            .getByRole('button', { name: /^Free section/ })
            .first()
            .click();
        await expect(page.getByText('This section is empty.')).toBeVisible();

        // A two-column layout, then a heading inside its first column.
        await page.getByRole('button', { name: 'Add a layout or element' }).click();
        await page.getByRole('button', { name: 'Two columns', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Add inside' })).toHaveCount(3);
        await addInside(page, 0, 'Heading');
        const title = `Winter shawls ${Math.random().toString(36).slice(2, 8)}`;
        await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(title);
        await expect(preview(page).getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });

        // Its size on phones only. The screen-size switch is the preview's too: styling phones
        // shows the phone. The number beside the phone says one thing is set there.
        await page.getByRole('tab', { name: 'Design' }).last().click();
        await page.getByRole('radio', { name: 'Phone', exact: true }).last().click();
        await page.getByRole('slider', { name: 'Size' }).fill('18');
        await expect(page.getByRole('radio', { name: 'Phone (1)' })).toBeVisible();
        await expect(page.locator(`iframe[title="${PREVIEW}"]`)).toHaveJSProperty('offsetWidth', 390);
        await expect(preview(page).getByRole('heading', { name: title })).toHaveCSS('font-size', '18px', {
            timeout: 15_000,
        });
        // On tablets nothing is set: the size there follows the computer, and the preview is 768 px.
        await page.getByRole('radio', { name: 'Tablet', exact: true }).last().click();
        await expect(page.locator('output', { hasText: '18 px' })).toHaveCount(0);
        await expect(page.locator(`iframe[title="${PREVIEW}"]`)).toHaveJSProperty('offsetWidth', 768);

        // A colour from the theme's own palette, then the design copied to a new heading.
        await page.getByRole('radio', { name: 'Computer', exact: true }).last().click();
        await page.getByRole('button', { name: 'Text colour: #b3261e' }).click();
        await page.getByRole('button', { name: 'Copy design' }).click();
        await page.getByRole('button', { name: 'All elements' }).click();
        await addInside(page, 0, 'Heading');
        await page.getByRole('tab', { name: 'Design' }).last().click();
        await page.getByRole('button', { name: 'Paste design' }).click();
        await expect(page.getByRole('radio', { name: 'Phone (1)' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Text colour: #b3261e' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        // Searching finds a setting in any group, on either tab.
        await page.getByRole('searchbox', { name: 'Search settings' }).fill('corner');
        await expect(page.getByRole('slider', { name: 'Corners' })).toBeVisible();
        await expect(page.getByRole('slider', { name: 'Size' })).toHaveCount(0);
        await page.getByRole('searchbox', { name: 'Search settings' }).fill('');

        // Back to the list: the heading is named by its words. A button goes in the second column.
        await page.getByRole('button', { name: 'All elements' }).click();
        await expect(page.getByRole('button', { name: `Heading ${title}` })).toBeVisible();
        await addInside(page, 1, 'Button');
        await expect(preview(page).getByRole('link', { name: 'Shop now' })).toBeVisible({ timeout: 15_000 });

        // Containers go three deep; a fourth is refused with the reason.
        await page.getByRole('button', { name: 'All elements' }).click();
        await addInside(page, 1, 'One below another');
        // The new container's own "Add inside" now comes before its parent's.
        await addInside(page, 1, 'One below another');
        await expect(page.getByText('Containers can go three deep at most.')).toBeVisible();

        await expect(page.getByText('Draft saved')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Published. The live page updates within seconds.')).toBeVisible();
        await waitForStorefront(`${SITE}/en/`, body => body.includes(title));
        expect(errors).toEqual([]);
    });

    test('a ready-made section opens up into elements, and undo closes it again', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        const errors = watchForErrors(page);
        const section = createSection('rich-text');
        section.settings.heading = text('About our shop');
        section.settings.text = text('<p>We stitch everything ourselves.</p>');
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        await openEditor(page);
        await page
            .getByRole('list', { name: 'Sections' })
            .getByRole('button', { name: /^Rich text/ })
            .first()
            .click();
        await page.getByRole('button', { name: 'Open up to edit freely' }).click();
        await expect(page.getByText('Opened up. Each part can now be changed on its own.')).toBeVisible();
        // Now a free section: its heading and text are elements of their own.
        await expect(page.getByRole('button', { name: 'Heading About our shop' })).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Text We stitch everything ourselves.' }),
        ).toBeVisible();
        await expect(
            preview(page).locator('.section-custom').getByRole('heading', { name: 'About our shop' }),
        ).toBeVisible({
            timeout: 15_000,
        });
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByRole('button', { name: 'Open up to edit freely' })).toBeVisible();
        await expect(preview(page).locator('.section-rich-text')).toBeVisible({ timeout: 15_000 });
        expect(errors).toEqual([]);
    });
});

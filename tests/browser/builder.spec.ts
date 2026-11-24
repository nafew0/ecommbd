import {
    createNode,
    createSection,
    createStructure,
    ELEMENTS,
    liveBlock,
    sectionsFor,
    type LayoutDocument,
    type NodeData,
    STRUCTURE_PRESETS,
} from '@ecommbd/sections';
import { expect, type Page, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { signIn, watchForErrors } from './support/admin-ui';
import { publishLayout, resetHome, setDraft, setTheme, waitForStorefront } from './support/sections';
import { adminSession, type ApiSession, randomPhone } from './support/store-api';

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

const layersOf = (page: Page) => page.getByRole('list', { name: 'Layers' });

/** Selects a layer by its name, then adds something inside it from its own picker. */
async function addIn(page: Page, layer: RegExp, nth: number, name: string) {
    await layersOf(page).getByRole('button', { name: layer }).nth(nth).click();
    await page.getByRole('button', { name: 'Add inside' }).last().click();
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
        // Its layers show under the section: a grid holding two columns.
        await expect(layersOf(page).getByRole('button', { name: /^(Grid|Column)$/ })).toHaveCount(3);
        await addIn(page, /^Column$/, 0, 'Heading');
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
        await addIn(page, /^Column$/, 0, 'Heading');
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

        // In the layers the heading is named by its words. A button goes in the second column.
        await expect(layersOf(page).getByRole('button', { name: `Heading ${title}` })).toBeVisible();
        await addIn(page, /^Column$/, 1, 'Button');
        await expect(preview(page).getByRole('link', { name: 'Shop now' })).toBeVisible({ timeout: 15_000 });

        // Containers go three deep; a fourth is refused with the reason.
        await addIn(page, /^Column$/, 1, 'One below another');
        await expect(layersOf(page).getByRole('button', { name: /^Column$/ })).toHaveCount(3);
        await addIn(page, /^Column$/, 2, 'One below another');
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
        await expect(layersOf(page).getByRole('button', { name: 'Heading About our shop' })).toBeVisible();
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
    test('a merchant edits on the canvas: selects, changes words in place, uses the toolbar, layers and Move to', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        test.setTimeout(120_000);
        const errors = watchForErrors(page);
        const section = createSection('custom');
        const [left, right] = section.children![0]!.children as [NodeData, NodeData];
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        // A wide window and the tablet view: the page is shown at its real size (Playwright can't
        // aim at a scaled-down frame), with the two columns side by side.
        await page.setViewportSize({ width: 1700, height: 900 });
        await openEditor(page);
        await page.getByRole('radio', { name: 'Tablet', exact: true }).first().click();
        const canvas = preview(page);
        const layers = layersOf(page);

        // A click on the page selects the element: its settings open and its layer is marked.
        await canvas.getByRole('heading', { name: 'Write your heading' }).click();
        await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue(
            'Write your heading',
        );
        await expect(layers.getByRole('button', { name: /^Heading Write your heading/ })).toHaveAttribute(
            'aria-current',
            'true',
        );
        await expect(canvas.locator('.canvas-frame .canvas-tag')).toHaveText('Heading');

        // Double-click to change the words right there; Enter finishes, and the panel has them too.
        await canvas.getByRole('heading', { name: 'Write your heading' }).dblclick();
        const editing = canvas.locator('[data-edit][contenteditable]');
        await editing.fill('Winter shawls are here');
        await editing.press('Enter');
        await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue(
            'Winter shawls are here',
        );
        await expect(canvas.getByRole('heading', { name: 'Winter shawls are here' })).toBeVisible({
            timeout: 15_000,
        });
        // Escape leaves the words as they were.
        await canvas.getByRole('heading', { name: 'Winter shawls are here' }).dblclick();
        await editing.fill('Something else');
        await editing.press('Escape');
        await expect(canvas.getByRole('heading', { name: 'Winter shawls are here' })).toBeVisible();

        // The toolbar on the selected element: duplicate, then undo takes the copy away.
        await canvas.locator('.canvas-tools').getByRole('button', { name: 'Duplicate' }).click();
        await expect(canvas.getByRole('heading', { name: 'Winter shawls are here' })).toHaveCount(2, {
            timeout: 15_000,
        });
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(canvas.getByRole('heading', { name: 'Winter shawls are here' })).toHaveCount(1, {
            timeout: 15_000,
        });

        // Layers: select the text from the list, give it a name of its own, and find it by that name.
        await layers.getByRole('button', { name: /^Text Add text/ }).click();
        await layers.getByRole('button', { name: /^Text Add text/ }).dblclick();
        await page.getByRole('textbox', { name: 'Name in the editor' }).fill('Intro words');
        await page.getByRole('textbox', { name: 'Name in the editor' }).press('Enter');
        await expect(layers.getByRole('button', { name: /^Intro words/ })).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search names or content' }).fill('intro');
        // Only the match and what holds it are left.
        await expect(layers.getByRole('button', { name: /^(Heading|Button|Image)/ })).toHaveCount(0);
        await expect(layers.getByRole('button', { name: /^(Grid|Column)$/ })).toHaveCount(2);
        await page.getByRole('searchbox', { name: 'Search names or content' }).fill('');

        // Selecting from the list scrolls the page inside its frame, never the frame itself.
        expect(
            await page
                .locator(`iframe[title="${PREVIEW}"]`)
                .evaluate(frame => frame.parentElement!.scrollLeft),
        ).toBe(0);

        // Move to: the text goes into the first column, chosen from lists instead of dragged.
        await page.getByRole('tab', { name: 'Advanced' }).click();
        await page.getByRole('combobox', { name: 'Where' }).selectOption({ index: 2 });
        await page.getByRole('combobox', { name: 'Position' }).selectOption({ index: 0 });
        await page.getByRole('button', { name: 'Move here' }).click();
        await expect(canvas.locator(`[data-u="${left.uid}"] > .el`).first()).toContainText(
            'Add text, buttons',
            { timeout: 15_000 },
        );
        // Hidden on phones, with an ID a button can jump to.
        await page.getByText('Hide on phones').click();
        await expect(page.getByRole('switch', { name: 'Hide on phones' })).toBeChecked();
        await page.getByRole('textbox', { name: 'Section ID' }).fill('Intro Words');
        await expect(canvas.locator('#intro-words')).toBeAttached({ timeout: 15_000 });

        // Drag in the layers: the button goes above the heading.
        await layers
            .getByRole('button', { name: /^Button Order now/ })
            .dragTo(layers.getByRole('button', { name: /^Heading Winter/ }), {
                targetPosition: { x: 40, y: 3 },
            });
        await expect(canvas.locator(`[data-u="${right.uid}"] > .el`).first()).toContainText('Order now', {
            timeout: 15_000,
        });

        // Keys: ? shows the list, P expands the canvas and brings the panels back.
        await page.getByRole('heading', { name: 'Sections' }).click();
        await page.keyboard.press('?');
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.keyboard.press('p');
        await expect(page.getByRole('list', { name: 'Sections' })).toBeHidden();
        await page.getByRole('button', { name: 'Back to editing' }).click();
        await expect(page.getByRole('list', { name: 'Sections' })).toBeVisible();

        // Copy the selected element, and paste it: on this page here, on any other page the same way.
        await layers.getByRole('button', { name: /^Button Order now/ }).click();
        await page.getByRole('heading', { name: 'Sections' }).click();
        await page.keyboard.press('ControlOrMeta+c');
        await expect(page.getByText('Copied. Paste it here or on another page.')).toBeVisible();
        await page.keyboard.press('ControlOrMeta+v');
        await expect(canvas.getByRole('link', { name: 'Order now' })).toHaveCount(2, { timeout: 15_000 });
        expect(errors).toEqual([]);
    });

    test('an element is dragged from the list onto the page, into the container under the pointer', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Dragging needs a mouse; phones use Move to');
        const section = createSection('custom');
        const [left] = section.children![0]!.children as [NodeData, NodeData];
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        await page.setViewportSize({ width: 1700, height: 900 });
        await openEditor(page);
        await page.getByRole('radio', { name: 'Tablet', exact: true }).first().click();
        await page
            .getByRole('list', { name: 'Sections' })
            .getByRole('button', { name: /^Free section/ })
            .first()
            .click();
        await page.getByRole('button', { name: 'Add a layout or element' }).click();
        const canvas = preview(page);
        // Playwright can't carry a real drag from one frame into another, so the drag's own events
        // are sent: picked up in the editor's list, then over and onto the first column on the page.
        const data = await page.evaluateHandle(() => new DataTransfer());
        await page
            .getByRole('button', { name: 'Badge', exact: true })
            .dispatchEvent('dragstart', { dataTransfer: data });
        const column = canvas.locator(`[data-u="${left.uid}"]`);
        await column.scrollIntoViewIfNeeded();
        const dropLine = canvas.locator('.canvas-drop');
        await expect(async () => {
            await column.evaluate(element => {
                const box = element.getBoundingClientRect();
                const at = { bubbles: true, cancelable: true, clientX: box.left + 30, clientY: box.top + 4 };
                element.dispatchEvent(new DragEvent('dragover', at));
            });
            // A line shows where it would land: above the image.
            await expect(dropLine).toBeVisible({ timeout: 500 });
        }).toPass({ timeout: 5000 });
        await column.evaluate(element => {
            const box = element.getBoundingClientRect();
            const at = { bubbles: true, cancelable: true, clientX: box.left + 30, clientY: box.top + 4 };
            element.dispatchEvent(new DragEvent('drop', at));
        });
        await expect(canvas.locator(`[data-u="${left.uid}"] > .el`).first()).toHaveClass(/el-badge/, {
            timeout: 15_000,
        });
        // What was dropped is selected, ready to change.
        await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('New');
    });
    test('the editor has a short tour that can be started again and skipped', async ({ page, isMobile }) => {
        test.skip(isMobile, 'The tour points at the three panels, which a phone shows one at a time');
        await setDraft(admin, 'home', { sections: [createSection('custom')] });
        await signIn(page, 'en');
        await openEditor(page);
        // It starts by itself on a first visit, never for an automated browser: here, from "More".
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Take the tour' }).click();
        const tour = page.getByRole('dialog');
        await expect(tour.getByRole('heading', { name: 'This is your page editor' })).toBeVisible();
        await tour.getByRole('button', { name: 'Show me around' }).click();
        for (const title of [
            'Your page, top to bottom',
            'Your real store, live',
            'Settings for what you selected',
            'Phone, tablet, computer',
        ]) {
            await expect(tour.getByRole('heading', { name: title })).toBeVisible();
            await tour.getByRole('button', { name: 'Next' }).click();
        }
        await expect(tour.getByRole('heading', { name: 'Publish when you’re ready' })).toBeVisible();
        await tour.getByRole('button', { name: 'Start working' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        // Skipped at any step.
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Take the tour' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Skip the tour' }).last().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    test('a merchant adds a ready section for their kind of store, tries a whole design and puts the page back', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        const errors = watchForErrors(page);
        const own = createSection('rich-text');
        own.settings.heading = text('My own page');
        await setDraft(admin, 'home', { sections: [own] });
        await signIn(page, 'en');
        await openEditor(page);
        const canvas = preview(page);

        // The library opens on ready sections: narrowed to a food store's, in the Trust category.
        await page.getByRole('button', { name: 'Add section', exact: true }).last().click();
        const library = page.getByRole('dialog', { name: 'Add a section' });
        await expect(library.getByRole('tab', { name: 'Ready sections' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await library.getByRole('combobox', { name: 'Your kind of store' }).selectOption({ label: 'Food' });
        await library.getByRole('radio', { name: 'Trust' }).click();
        await expect(library.getByRole('button', { name: /^Fashion:/ })).toHaveCount(0);
        await library.getByRole('button', { name: /^Food: our promises/ }).click();
        await expect(canvas.getByText('Nothing added')).toBeVisible({ timeout: 15_000 });

        // A whole design, tried on the real page; the page comes back with one click.
        await page.getByRole('button', { name: 'Add section', exact: true }).last().click();
        await library.getByRole('tab', { name: 'Templates' }).click();
        await library.getByRole('button', { name: /^Fashion home page/ }).click();
        const bar = page.getByRole('status').filter({ hasText: 'You’re trying “Fashion home page”' });
        await expect(bar).toBeVisible();
        await expect(canvas.getByRole('heading', { name: 'Your style, at your price' })).toBeVisible({
            timeout: 15_000,
        });
        await page.getByRole('radio', { name: 'Tablet', exact: true }).first().click();
        await expect(page.locator(`iframe[title="${PREVIEW}"]`)).toHaveJSProperty('offsetWidth', 768);
        await bar.getByRole('button', { name: 'Put my page back' }).click();
        await expect(canvas.getByRole('heading', { name: 'My own page' })).toBeVisible({ timeout: 15_000 });
        await expect(canvas.getByRole('heading', { name: 'Your style, at your price' })).toHaveCount(0);
        await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem')).toHaveCount(2);

        // Tried again and kept.
        await page.getByRole('button', { name: 'Add section', exact: true }).last().click();
        await library.getByRole('tab', { name: 'Templates' }).click();
        await library.getByRole('button', { name: /^Fashion home page/ }).click();
        await bar.getByRole('button', { name: 'Keep it' }).click();
        await expect(page.getByText('Design kept. Change anything, then publish.')).toBeVisible();
        await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem')).toHaveCount(8);
        expect(errors).toEqual([]);
    });
    test('the checklist finds what to fix before publishing, on the page and on a phone', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        const errors = watchForErrors(page);
        const section = createSection('custom');
        const sample = createNode('heading');
        const noPhoto = createNode('image');
        const wide = createNode('text', { text: text('<p>These words stick out of a phone.</p>') });
        wide.style = { base: { width: 100, marginLeft: 200 } };
        const tiny = createNode('button', {
            label: text('Read more'),
            link: { type: 'search' },
            look: 'link',
        });
        const broken = createNode('button', { label: text('Buy'), link: { type: 'url', url: 'not a link' } });
        section.children = [sample, noPhoto, wide, tiny, broken];
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        await openEditor(page);

        // The count on the button is red while something blocks publishing.
        await page.getByRole('button', { name: /^Checklist/ }).click();
        const checklist = page.getByRole('dialog', { name: 'Before you publish' });
        await expect(checklist.getByText('Must fix before publishing · 1')).toBeVisible();
        await expect(
            checklist.getByText('A link isn’t a web address or a path on your store.'),
        ).toBeVisible();
        await expect(checklist.getByText('This still has the sample words. Write your own.')).toBeVisible();
        await expect(checklist.getByText('No photo chosen yet.')).toBeVisible();
        // Measured on the page itself, at phone width.
        await expect(page.locator(`iframe[title="${PREVIEW}"]`)).toHaveJSProperty('offsetWidth', 390);
        await expect(
            checklist.getByText('On a phone this sticks out and the page scrolls sideways.').first(),
        ).toBeVisible({
            timeout: 10_000,
        });
        await expect(
            checklist.getByText('On a phone this is too small to tap easily (under 44 px).'),
        ).toBeVisible();

        // A line goes to what it's about.
        await checklist.getByRole('button', { name: /No photo chosen yet/ }).click();
        await expect(checklist).toBeHidden();
        await expect(layersOf(page).getByRole('button', { name: /^Image$/ })).toHaveAttribute(
            'aria-current',
            'true',
        );

        // Publishing is stopped, and says where to look.
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Fix what the checklist marks in red, then publish.')).toBeVisible();
        await expect(checklist).toBeVisible();
        await page.keyboard.press('Escape');

        // With the broken link fixed, nothing blocks it.
        await layersOf(page)
            .getByRole('button', { name: /^Button Buy/ })
            .click();
        await page.getByRole('textbox', { name: 'Web address' }).fill('https://example.com/shop');
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Published. The live page updates within seconds.')).toBeVisible({
            timeout: 15_000,
        });
        expect(errors).toEqual([]);
    });
    test('Online store opens on an overview that leads to the home page editor, sales pages and back', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The menu is a drawer on a phone');
        await signIn(page, 'en');
        await page.goto('/admin/');
        await page.getByRole('link', { name: 'Online store' }).click();
        await expect(page).toHaveURL(/\/admin\/store$/);
        await expect(page.getByRole('heading', { name: 'Online store', level: 1 })).toBeVisible();
        // The area's own menu is there, with Sales pages inside it.
        const menu = page.getByRole('navigation').first();
        for (const name of [
            'Home page',
            'Product page',
            'Sales pages',
            'Pages',
            'Menus',
            'Theme',
            'Search',
        ]) {
            await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
        }
        await page
            .getByRole('main')
            .getByRole('link', { name: /^Sales pages/ })
            .click();
        await expect(page).toHaveURL(/\/admin\/sales-pages$/);
        await expect(menu.getByRole('link', { name: 'Home page', exact: true })).toBeVisible();
        // The home page editor is full screen; its back arrow returns to the overview.
        await menu.getByRole('link', { name: 'Home page', exact: true }).click();
        await expect(preview(page).locator('body[data-preview="editor"]')).toBeAttached({ timeout: 15_000 });
        await page.getByRole('link', { name: 'Back', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/store$/);
    });
    test('a menu group opens on a click and closes on the next', async ({ page, isMobile }) => {
        test.skip(isMobile, 'The menu is a drawer on a phone');
        await signIn(page, 'en');
        await page.goto('/admin/');
        const menu = page.getByRole('navigation').first();
        const orders = menu.getByRole('button', { name: /^Orders/ });
        await orders.click();
        await expect(orders).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.getByRole('link', { name: 'All orders' })).toBeVisible();
        await orders.click();
        await expect(orders).toHaveAttribute('aria-expanded', 'false');
        await expect(menu.getByRole('link', { name: 'All orders' })).toBeHidden();
        // Still on the orders screen: closing the group doesn't leave the page.
        await expect(page).toHaveURL(/\/admin\/orders$/);
        await orders.click();
        await expect(menu.getByRole('link', { name: 'All orders' })).toBeVisible();
    });
    test('a page with every element and every ready block at once stays within the script budget', async ({
        page,
        isMobile,
    }) => {
        test.skip(!isMobile, 'Measured on the phone');
        const section = createSection('custom');
        const elements = ELEMENTS.filter(
            definition => !definition.internal && definition.type !== 'container',
        ).map(definition => createNode(definition.type));
        // The product elements get real products.
        const { products } = await admin.query(
            '{ products(options: { take: 3, filter: { enabled: { eq: true } } }) { items { id name } } }',
        );
        const ids = (products.items as Array<{ id: string }>).map(item => item.id);
        for (const node of elements) {
            if ('product' in node.props) node.props.product = ids[0]!;
            if ('products' in node.props) node.props.products = ids;
        }
        const map = elements.find(node => node.type === 'map')!;
        map.props.place = 'Dhanmondi 27, Dhaka';
        const blocks = sectionsFor('home')
            .filter(definition => !definition.tree)
            .map(definition => liveBlock(definition.type));
        const column = createNode('container');
        column.children = [...elements, ...blocks];
        section.children = [column];
        const marker = `all${Math.random().toString(36).slice(2, 8)}`;
        section.style.anchor = marker;
        await publishLayout(admin, 'home', { sections: [section] });
        await waitForStorefront(`${SITE}/en/`, html => html.includes(`id="${marker}"`));
        const scripts: string[] = [];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('response', response => {
            // Ours only: the map is Google's page in a frame, with Google's own script.
            if (response.request().resourceType() === 'script' && response.url().startsWith(SITE))
                scripts.push(response.url());
        });
        await page.goto(`${SITE}/en/`);
        await page.waitForLoadState('networkidle');
        let gzipped = 0;
        for (const url of scripts)
            gzipped += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
        console.log(
            `every element: ${elements.length} elements, ${blocks.length} blocks, ${(gzipped / 1024).toFixed(1)} KB first-party JS gzipped`,
        );
        expect(elements.length + blocks.length).toBeGreaterThanOrEqual(60);
        // Even the product page's budget, the tighter of the two.
        expect(gzipped).toBeLessThanOrEqual(30 * 1024);
        // Nothing sticks out of a phone, and nothing was refused by the page's security policy.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            await page.evaluate(() => window.innerWidth),
        );
        expect(errors.filter(error => !error.includes('google.com'))).toEqual([]);
        // A few of them, working without script: an accordion opens, a tab switches.
        const accordion = page.locator('.el-accordion details').first();
        await accordion.locator('summary').click();
        await expect(accordion).toHaveAttribute('open', '');
        await page.locator('.el-tabs .tab-list label').nth(1).click();
        await expect(page.locator('.el-tabs .tab-panel').nth(1)).toBeVisible();
        await expect(page.locator('.el-tabs .tab-panel').nth(0)).toBeHidden();

        // The product elements show the live product, and the button puts it in the cart.
        await expect(page.locator('.el-product .card-title')).toHaveText(products.items[0].name);
        expect(await page.locator('.product-row .card').count()).toBe(ids.length);
        await page.locator('.buy-inline button').click();
        await expect(page.locator('[data-cart]').getByText(products.items[0].name).first()).toBeVisible();
    });

    test('the element picker finds an element by name, by group, and adds it', async ({ page, isMobile }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
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
        await page.getByRole('button', { name: 'Add a layout or element' }).click();

        // By name, in either language.
        const search = page.getByRole('searchbox', { name: 'Search elements' });
        await search.fill('accord');
        await expect(page.getByRole('button', { name: 'Accordion', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Heading', exact: true })).toHaveCount(0);
        await search.fill('ট্যাব');
        await expect(page.getByRole('button', { name: 'Tabs', exact: true })).toBeVisible();
        await search.fill('');

        // By group: the ready blocks keep their live data.
        await page.getByRole('radio', { name: 'Ready blocks' }).click();
        await expect(page.getByRole('button', { name: 'Product grid', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Accordion', exact: true })).toHaveCount(0);
        await page.getByRole('radio', { name: 'Promotion' }).click();
        // Pointing at one says what it is.
        await page.getByRole('button', { name: 'Ticker', exact: true }).hover();
        await expect(
            page.getByText('Ticker: Short lines that glide across, one after another'),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Accordion', exact: true }).click();
        await expect(preview(page).locator('.el-accordion summary').first()).toHaveText('How do I order?', {
            timeout: 15_000,
        });
        expect(errors).toEqual([]);
    });
    test('a shopper sends a message through a contact form, and the merchant reads and answers it', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Once is enough');
        const errors = watchForErrors(page);
        const section = createSection('custom');
        section.children = [createNode('contact-form')];
        const marker = `form${Math.random().toString(36).slice(2, 8)}`;
        section.style.anchor = marker;
        await publishLayout(admin, 'home', { sections: [section] });
        await waitForStorefront(`${SITE}/en/`, html => html.includes(`id="${marker}"`));
        await page.goto(`${SITE}/en/`);
        const form = page.locator('.contact-form');
        const name = `Karim ${marker}`;

        // A number that isn't a mobile number is refused, and says so.
        await form.getByLabel('Your name').fill(name);
        await form.getByLabel('Mobile number').fill('12345');
        await form.getByRole('button', { name: 'Send' }).click();
        await expect(page.getByRole('alert')).toContainText('valid mobile number');
        await page.getByRole('link', { name: 'Back to the page' }).click();

        const phone = randomPhone();
        await form.getByLabel('Your name').fill(name);
        await form.getByLabel('Mobile number').fill(phone);
        await form.getByLabel('Your message').fill('Do you deliver to Sylhet?');
        await form.getByRole('button', { name: 'Send' }).click();
        await expect(page.getByRole('heading', { name: 'We got your message' })).toBeVisible();

        // The merchant finds it under Customers, Messages.
        await signIn(page, 'en');
        await page.goto('/admin/customers/messages');
        const row = page.getByRole('row').filter({ hasText: name });
        await expect(row).toContainText('Do you deliver to Sylhet?');
        await expect(row.getByRole('link', { name: 'Call' })).toHaveAttribute('href', /^tel:\+8801/);
        await row.getByRole('button', { name: 'Answered' }).click();
        await expect(page.getByText('Marked as answered')).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
        await page.getByRole('tab', { name: 'Answered' }).click();
        await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
        // The refused number answers 422 on purpose.
        expect(errors.filter(error => !error.includes('422'))).toEqual([]);
    });
    test('my library: a linked section, a saved page, favourites and search', async ({ page, isMobile }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        page.setDefaultTimeout(8000);
        const errors = watchForErrors(page);
        const tag = Math.random().toString(36).slice(2, 7);
        const banner = createSection('banner');
        await setDraft(admin, 'home', { sections: [banner, createSection('faq')] });
        await signIn(page, 'en');
        await openEditor(page);
        const list = page.getByRole('list', { name: 'Sections' });

        // Saved as a linked section: the one it came from is linked too.
        await page.getByRole('button', { name: /^Actions for Offer banner/ }).click();
        await page.getByRole('menuitem', { name: 'Save to my library' }).click();
        await page.locator('#saved-section-name').fill(`Strip ${tag}`);
        await page.getByRole('switch', { name: /Linked section/ }).check({ force: true });
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByText('Saved as a linked section.')).toBeVisible();
        await expect(list.getByText('Linked', { exact: true })).toHaveCount(1);
        await list
            .getByRole('button', { name: /^Offer banner/ })
            .first()
            .click();
        await expect(page.getByText('This section is on other pages too.')).toBeVisible();

        // The whole page, saved as a starting point.
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Save page to my library' }).click();
        await page.locator('#saved-page-name').fill(`Page ${tag}`);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByText('Saved. Find it under Add section → My library.')).toBeVisible();

        // My library finds them: by kind, by name, favourites on top.
        await page.getByRole('button', { name: 'Add section' }).first().click();
        await page.getByRole('tab', { name: 'My library' }).click();
        const linked = page.getByRole('button', { name: `Add linked: Strip ${tag}` });
        const saved = page.getByRole('button', { name: `Use this page: Page ${tag}` });
        await expect(linked).toBeVisible();
        await expect(saved).toBeVisible();
        await page.getByRole('radio', { name: /^Pages/ }).click();
        await expect(linked).toHaveCount(0);
        await page.getByRole('radio', { name: /^All/ }).click();
        await page.getByRole('searchbox', { name: 'Search my library' }).fill(`strip ${tag}`);
        await expect(saved).toHaveCount(0);
        await page.getByRole('button', { name: `Mark as favourite: Strip ${tag}` }).click();
        await expect(
            page.getByRole('button', { name: `Remove from favourites: Strip ${tag}` }),
        ).toBeVisible();

        // Added again: the same section twice, both linked.
        await linked.click();
        await expect(list.getByText('Linked', { exact: true })).toHaveCount(2);
        // Unlinked, one stands on its own.
        await page.getByRole('button', { name: 'Unlink from library' }).click();
        await expect(list.getByText('Linked', { exact: true })).toHaveCount(1);
        expect(errors).toEqual([]);

        // Tidy up: the library is the store's, not this test's.
        const { bdSavedSections } = await admin.query('{ bdSavedSections { id name } }');
        for (const row of bdSavedSections as Array<{ id: string; name: string }>) {
            if (row.name.endsWith(tag))
                await admin.query('mutation ($id: ID!) { deleteBdSavedSection(id: $id) }', { id: row.id });
        }
    });
    test('a saved style: one look with a name, used on two elements and changed in one place', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        page.setDefaultTimeout(10_000);
        const errors = watchForErrors(page);
        const tag = Math.random().toString(36).slice(2, 7);
        const section = createSection('custom');
        const first = createNode('heading', { text: text(`First ${tag}`) });
        first.style = { base: { color: '#b3261e' } };
        const second = createNode('heading', { text: text(`Second ${tag}`) });
        section.children = [first, second];
        await setTheme(admin);
        await setDraft(admin, 'home', { sections: [section] });
        await signIn(page, 'en');
        await openEditor(page);
        await page
            .getByRole('list', { name: 'Sections' })
            .getByRole('button', { name: /^Free section/ })
            .first()
            .click();

        // The first heading's look, saved under a name.
        await layersOf(page)
            .getByRole('button', { name: `Heading First ${tag}` })
            .click();
        await page.getByRole('tab', { name: 'Design' }).last().click();
        await page.getByRole('button', { name: 'Save as a new style' }).click();
        await page.getByRole('textbox', { name: 'Name of the style' }).fill(`Red ${tag}`);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByText(`Saved as "Red ${tag}".`)).toBeVisible();
        await expect(page.getByLabel('Saved style')).toContainText(`Red ${tag}`);

        // The second heading takes it.
        await layersOf(page)
            .getByRole('button', { name: `Heading Second ${tag}` })
            .click();
        await page.getByRole('tab', { name: 'Design' }).last().click();
        await page.getByLabel('Saved style').selectOption({ label: `Red ${tag}` });
        const red = 'rgb(179, 38, 30)';
        await expect(preview(page).getByRole('heading', { name: `Second ${tag}` })).toHaveCSS('color', red, {
            timeout: 15_000,
        });
        await expect(preview(page).getByRole('heading', { name: `First ${tag}` })).toHaveCSS('color', red);

        // Changed on the second and sent to the style: the first follows.
        await page.getByRole('button', { name: 'Text colour: #121212' }).click();
        await page.getByRole('button', { name: `Update "Red ${tag}" everywhere` }).click();
        await expect(page.getByText(`"Red ${tag}" updated on every page that uses it.`)).toBeVisible();
        const ink = 'rgb(18, 18, 18)';
        await expect(preview(page).getByRole('heading', { name: `First ${tag}` })).toHaveCSS('color', ink, {
            timeout: 15_000,
        });

        // Live for shoppers too.
        await expect(page.getByText('Draft saved')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Published. The live page updates within seconds.')).toBeVisible();
        await waitForStorefront(`${SITE}/en/`, body => body.includes(`Second ${tag}`));
        expect(errors).toEqual([]);
        await setTheme(admin);
    });
    test('elements enter as they are scrolled to, one after another, and stay still for reduced motion', async ({
        browser,
        isMobile,
    }) => {
        test.skip(!isMobile, 'Measured on the phone');
        const section = createSection('custom');
        const tall = createNode('spacer', { height: 240 });
        const far = createNode('container', { direction: 'column' });
        far.children = [
            createNode('heading', { text: text('Far down') }),
            createNode('text'),
            createNode('stat', { value: text('5,000+', '৫,০০০+') }),
        ];
        Object.assign(far, { animate: 'rise', stagger: true, animateDelay: 100 });
        const top = Object.assign(createNode('heading', { text: text('On the first screen') }), {
            animate: 'slide-left',
            hover: 'lift',
        });
        section.children = [
            top,
            tall,
            createNode('spacer', { height: 240 }),
            createNode('spacer', { height: 240 }),
            createNode('spacer', { height: 240 }),
            far,
        ];
        const marker = `motion${Math.random().toString(36).slice(2, 8)}`;
        section.style.anchor = marker;
        await publishLayout(admin, 'home', { sections: [section] });
        await waitForStorefront(`${SITE}/en/`, html => html.includes(`id="${marker}"`));

        const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
        const page = await context.newPage();
        const errors = watchForErrors(page);
        await page.goto(`${SITE}/en/`);
        await page.waitForLoadState('networkidle');
        // What is on the first screen plays from the stylesheet; nothing there waits for script.
        const first = page.locator('.el[data-anim="slide-left"]');
        await expect(first).toHaveCSS('animation-name', 'node-slide-left');
        await expect(first).toHaveClass(/hover-lift/);
        // Further down, each piece is held until it is scrolled to.
        const pieces = page.locator('[data-stagger] > .el');
        await expect(pieces).toHaveCount(3);
        for (const index of [0, 1, 2]) await expect(pieces.nth(index)).toHaveCSS('opacity', '0');
        await pieces.first().scrollIntoViewIfNeeded();
        for (const index of [0, 1, 2]) await expect(pieces.nth(index)).toHaveCSS('opacity', '1');
        // The number counted up to what was written.
        await expect(page.locator('.stat-value')).toHaveText('5,000+');
        expect(errors).toEqual([]);
        await context.close();

        // Asked for less motion: everything is simply there.
        const calm = await browser.newContext({
            viewport: { width: 390, height: 700 },
            reducedMotion: 'reduce',
        });
        const still = await calm.newPage();
        await still.goto(`${SITE}/en/`);
        await still.waitForLoadState('networkidle');
        for (const index of [0, 1, 2])
            await expect(still.locator('[data-stagger] > .el').nth(index)).toHaveCSS('opacity', '1');
        await expect(still.locator('.el[data-anim="slide-left"]')).toHaveCSS('animation-name', 'none');
        await calm.close();
    });
});

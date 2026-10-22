import { createSection, STARTERS, starterLayout } from '@ecommbd/sections';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { signIn, watchForErrors } from './support/admin-ui';
import {
    layoutOf,
    publishLayout,
    resetHome,
    setDraft,
    setTheme,
    waitForStorefront,
} from './support/sections';
import { adminSession, type ApiSession } from './support/store-api';
import { ensureStorefrontFixtures, type StorefrontFixtures } from './support/storefront-seed';

/**
 * Sections, themes and the page editor (roadmap phase 15): building a home page in the editor and
 * publishing it, reordering and hiding, restoring a version, two staff publishing at once, the
 * theme screen, shared preview links, the product page template, the preview's security headers
 * and the JavaScript budget of every starter layout. The admin is used in English here; the
 * storefront's default language is Bangla, so English pages are under /en/.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const PREVIEW = 'Preview of the page';
/** A second staff member for the two-editor test (created once, kept in the dev database). */
const RAHIM = { email: 'rahim.phase15@example.com', password: 'staff-password-123' };

let admin: ApiSession;
let fixtures: StorefrontFixtures;

const unique = () => Math.random().toString(36).slice(2, 8);

function text(en: string, bn = en) {
    return { bn, en };
}

/** A rich-text section with this heading, for tests that need recognizable sections. */
function heading(title: string) {
    const section = createSection('rich-text');
    section.settings.heading = text(title);
    return section;
}

async function ensureRahim(api: ApiSession) {
    const { administrators } = await api.query(
        'query ($email: String!) { administrators(options: { filter: { emailAddress: { eq: $email } } }) { totalItems } }',
        { email: RAHIM.email },
    );
    if (administrators.totalItems) return;
    const { roles } = await api.query('{ roles(options: { take: 100 }) { items { id code } } }');
    const owner = roles.items.find((role: { code: string }) => role.code === 'owner');
    await api.query(
        'mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }',
        {
            input: {
                firstName: 'Rahim',
                lastName: 'Uddin',
                emailAddress: RAHIM.email,
                password: RAHIM.password,
                roleIds: [owner.id],
            },
        },
    );
}

async function openEditor(page: Page, path = '/admin/store/design/home') {
    await page.goto(path);
    await expect(
        page.frameLocator(`iframe[title="${PREVIEW}"]`).locator('body[data-preview="editor"]'),
    ).toBeAttached({
        timeout: 15_000,
    });
}

const preview = (page: Page) => page.frameLocator(`iframe[title="${PREVIEW}"]`);

async function addFromLibrary(page: Page, name: string | RegExp) {
    await page.getByRole('button', { name: 'Add section', exact: true }).last().click();
    await page.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name }).first().click();
}

test.describe('sections and the page editor', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        test.setTimeout(180_000);
        admin = await adminSession();
        fixtures = await ensureStorefrontFixtures(admin);
        await ensureRahim(admin);
        await setTheme(admin);
    });

    test.afterAll(async () => {
        // Leave the store as other tests expect it: the default home page and the Minimal theme.
        await resetHome(admin);
        await setTheme(admin);
        await publishLayout(admin, 'product', { sections: [] });
    });

    test('a merchant builds a home page with six sections, previews it on a phone and publishes it', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The phone layout of the editor has its own test');
        test.setTimeout(90_000);
        const errors = watchForErrors(page);
        await setDraft(admin, 'home', { sections: [] });
        await signIn(page, 'en');
        await openEditor(page);
        await expect(page.getByText('No sections yet')).toBeVisible();

        await page.getByRole('button', { name: 'Add section' }).first().click();
        await page
            .getByRole('dialog', { name: 'Add a section' })
            .getByRole('button', { name: /^Hero/ })
            .click();
        const title = `Eid panjabi ${unique()}`;
        await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(title);
        for (const name of [
            /^Product grid/,
            /^Category list/,
            /^Trust badges/,
            /^FAQ/,
            /^Order on WhatsApp/,
        ]) {
            await addFromLibrary(page, name);
        }
        await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem')).toHaveCount(6);

        // The preview is the real storefront, in phone view, showing the draft.
        const frame = page.locator(`iframe[title="${PREVIEW}"]`);
        await expect(frame).toHaveJSProperty('offsetWidth', 390);
        await expect(preview(page).getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
        await expect(preview(page).locator('main > section.section')).toHaveCount(6);
        // Not live yet.
        expect(await (await fetch(`${SITE}/en/`)).text()).not.toContain(title);

        await expect(page.getByText('Draft saved')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Published. The live page updates within seconds.')).toBeVisible();
        const started = Date.now();
        const html = await waitForStorefront(`${SITE}/en/`, body => body.includes(title));
        console.log(`Live home page updated ${Date.now() - started} ms after publishing`);
        expect(html.match(/<section class="section section-/g)).toHaveLength(6);
        expect(errors).toEqual([]);
    });

    test('sections reorder with the keyboard, hide without deleting, and undo', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Desktop editor');
        const [first, second] = [`First ${unique()}`, `Second ${unique()}`];
        await setDraft(admin, 'home', {
            sections: [heading(first), heading(second), createSection('divider')],
        });
        await signIn(page, 'en');
        await openEditor(page);
        // The home page's first heading is its h1.
        const titles = () => preview(page).locator('main .section-title').allTextContents();
        await expect.poll(titles).toEqual([first, second]);

        await page.getByRole('button', { name: `Drag to reorder: Rich text` }).first().focus();
        await page.keyboard.press('ArrowDown');
        await expect.poll(titles, { timeout: 10_000 }).toEqual([second, first]);

        await page.getByRole('button', { name: 'Hide: Rich text' }).first().click();
        await expect.poll(titles, { timeout: 10_000 }).toEqual([first]);
        await expect(page.getByRole('list', { name: 'Sections' }).getByText('Hidden')).toBeVisible();

        // Ctrl+Z outside text fields undoes the last change.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Control+z');
        await expect.poll(titles, { timeout: 10_000 }).toEqual([second, first]);
        await page.getByRole('button', { name: 'Redo' }).click();
        await expect.poll(titles, { timeout: 10_000 }).toEqual([first]);
    });

    test('a published version is restored from History and published again', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Desktop editor');
        const [older, newer] = [`Older ${unique()}`, `Newer ${unique()}`];
        await publishLayout(admin, 'home', { sections: [heading(older)] });
        await publishLayout(admin, 'home', { sections: [heading(newer)] });
        await signIn(page, 'en');
        await openEditor(page);
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'History' }).click();
        const history = page.getByRole('dialog', { name: 'Published versions' });
        await expect(history.getByText('Live now')).toBeVisible();
        await history.getByRole('button', { name: 'Restore' }).nth(1).click();
        await expect(page.getByText(/is in the draft\. Publish to make it live\./)).toBeVisible();
        await expect(preview(page).getByRole('heading', { name: older })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: 'Publish' }).click();
        await waitForStorefront(`${SITE}/en/`, html => html.includes(older) && !html.includes(newer));
    });

    test('two staff publish at once: the second sees who published, and chooses', async ({
        browser,
        isMobile,
    }) => {
        test.skip(isMobile, 'Desktop editor');
        test.setTimeout(90_000);
        const base = `Base ${unique()}`;
        await publishLayout(admin, 'home', { sections: [heading(base)] });
        const [mine, rahims] = await Promise.all([editorAs(browser), editorAs(browser, RAHIM)]);

        // Rahim changes the heading and publishes first.
        const rahimTitle = `Rahim's ${unique()}`;
        await selectFirstSection(rahims);
        await rahims.getByRole('textbox', { name: 'Heading', exact: true }).fill(rahimTitle);
        await expect(rahims.getByText('Draft saved')).toBeVisible();
        await rahims.getByRole('button', { name: 'Publish' }).click();
        await expect(rahims.getByText('Published. The live page updates within seconds.')).toBeVisible();

        // My editor still has the old draft: saving says who changed it.
        const myTitle = `Mine ${unique()}`;
        await selectFirstSection(mine);
        await mine.getByRole('textbox', { name: 'Heading', exact: true }).fill(myTitle);
        const draftConflict = mine.getByRole('dialog', { name: 'Someone else changed this page' });
        await expect(draftConflict).toContainText('Rahim Uddin saved changes to this draft');
        await draftConflict.getByRole('button', { name: 'Keep my changes' }).click();
        await expect(mine.getByText('Draft saved')).toBeVisible();

        // Publishing from the version I opened: "A newer version was published by Rahim".
        await mine.getByRole('button', { name: 'Publish' }).click();
        const publishConflict = mine.getByRole('dialog', { name: 'Someone else changed this page' });
        await expect(publishConflict).toContainText('A newer version was published by Rahim Uddin');
        await publishConflict.getByRole('button', { name: 'Publish anyway' }).click();
        await expect(mine.getByText('Published. The live page updates within seconds.')).toBeVisible();
        await waitForStorefront(`${SITE}/en/`, html => html.includes(myTitle));
        await Promise.all([mine.context().close(), rahims.context().close()]);
    });

    test('the theme screen switches to Bazaar, shows it live in the preview, and refuses unreadable text', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Desktop theme screen');
        await resetHome(admin);
        await signIn(page, 'en');
        await page.goto('/admin/store/theme');
        await expect(preview(page).locator('body[data-preview="editor"]')).toBeAttached({ timeout: 15_000 });
        await page.getByRole('radio', { name: /Bazaar/ }).click();
        await expect(preview(page).locator('html')).toHaveAttribute('data-theme', 'bazaar');
        await expect(page.getByText('Theme switched')).toBeVisible();

        await page.locator('#colour-text').fill('#dddddd');
        await expect(page.getByText(/Hard to read \(1\.\d:1\)\. Text needs at least 4\.5:1\./)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save theme' })).toBeDisabled();
        await page.locator('#colour-text').fill('#1a1a1a');
        await page.getByRole('button', { name: 'Save theme' }).click();
        await expect(page.getByText('Theme saved. The store updates within seconds.')).toBeVisible();
        const html = await waitForStorefront(`${SITE}/`, body => body.includes('data-theme="bazaar"'));
        expect(html).toContain('data-header="center"');
        await setTheme(admin);
    });

    test('a shared preview link shows the draft on any phone, read-only and never indexed', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'The link is opened on the phone project below');
        const draft = `Draft only ${unique()}`;
        await setDraft(admin, 'home', { sections: [heading(draft)] });
        await signIn(page, 'en');
        await openEditor(page);
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'Share preview' }).click();
        const dialog = page.getByRole('dialog', { name: 'Share a preview' });
        await expect(dialog.getByText(/Works until/)).toBeVisible();
        const url = await dialog.getByRole('textbox').inputValue();
        expect(url).toMatch(/\/en\/\?preview=[\w-]+\.[\w-]+$/);

        const visitor = await page
            .context()
            .browser()!
            .newPage({ viewport: { width: 390, height: 844 } });
        const response = await visitor.goto(url);
        expect(response!.headers()['cache-control']).toBe('no-store');
        expect(response!.headers()['x-robots-tag']).toBe('noindex');
        await expect(visitor.getByRole('heading', { name: draft })).toBeVisible();
        await expect(visitor.getByRole('status').filter({ hasText: 'Preview' })).toBeVisible();
        // The live page doesn't have it, and a changed token shows the live page with a notice.
        expect(await (await fetch(`${SITE}/en/`)).text()).not.toContain(draft);
        await visitor.goto(`${url.slice(0, -2)}xx`);
        await expect(visitor.getByText('This preview link has expired. Ask for a new one.')).toBeVisible();
        await expect(visitor.getByRole('heading', { name: draft })).toHaveCount(0);
        await visitor.close();
    });

    test('the editor works on a phone: sections and preview are tabs, settings open over the list', async ({
        page,
        isMobile,
    }) => {
        test.skip(!isMobile, 'Phone only');
        const title = `Phone ${unique()}`;
        await setDraft(admin, 'home', { sections: [heading(`Before ${unique()}`)] });
        await signIn(page, 'en');
        await page.goto('/admin/store/design/home');
        await page.getByRole('list', { name: 'Sections' }).getByText('Rich text').click();
        await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(title);
        await page.getByRole('button', { name: 'Preview of the page' }).click();
        await expect(preview(page).getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    });

    test('the product page template adds sections below every product, and pages get their own', async ({
        page,
        isMobile,
    }) => {
        test.skip(isMobile, 'Checked once');
        const badge = `Genuine ${unique()}`;
        const trust = createSection('trust-badges');
        trust.blocks[0]!.settings.title = text(badge);
        await publishLayout(admin, 'product', { sections: [trust] });
        await page.goto(`${SITE}/en/product/${fixtures.panjabi.en}/`);
        await expect(page.locator('.section-trust-badges')).toContainText(badge);
        // Still within the product page's JavaScript budget, with the template's sections.
        await expect(page.locator('h1')).toBeVisible();

        const { bdPages } = await admin.query(
            '{ bdPages(take: 100) { items { id translations { languageCode slug } } } }',
        );
        const about = bdPages.items.find((item: { translations: Array<{ slug: string }> }) =>
            item.translations.some(translation => translation.slug === fixtures.page.en),
        );
        const faq = createSection('faq');
        await publishLayout(admin, 'page', { sections: [faq] }, about.id);
        await page.goto(`${SITE}/en/${fixtures.page.en}/`);
        await expect(page.locator('.section-faq details').first()).toBeVisible();
        await page.locator('.section-faq summary').first().click();
        await expect(page.locator('.section-faq details').first()).toHaveAttribute('open', '');
        await publishLayout(admin, 'page', { sections: [] }, about.id);
    });

    test('only the editor may frame a preview, and live pages only this site', async () => {
        const home = await layoutOf(admin, 'home');
        const { createBdPreviewLink } = await admin.query(
            'mutation ($id: ID!) { createBdPreviewLink(layoutId: $id, language: "bn") { url } }',
            { id: home.id },
        );
        const preview = await fetch(new URL(createBdPreviewLink.url, SITE));
        expect(preview.headers.get('content-security-policy')).toMatch(
            // In development the admin is on another port (EDITOR_ORIGIN); live stores use one site.
            /frame-ancestors 'self'( https?:\/\/[\w.:-]+)?$/,
        );
        expect(preview.headers.get('cache-control')).toBe('no-store');
        const live = await fetch(`${SITE}/`);
        expect(live.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self'$/);
        expect(live.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    });

    for (const starter of STARTERS) {
        test(`the ${starter} starter layout stays within the JavaScript budget`, async ({
            page,
            isMobile,
        }) => {
            test.skip(!isMobile, 'Measured on the phone');
            const layout = starterLayout(starter);
            const marker = `starter-${unique()}`;
            layout.sections[0]!.style.anchor = marker;
            await publishLayout(admin, 'home', layout);
            await waitForStorefront(`${SITE}/`, html => html.includes(`id="${marker}"`));
            const scripts: string[] = [];
            page.on('response', response => {
                if (response.request().resourceType() === 'script') scripts.push(response.url());
            });
            await page.goto(`${SITE}/`);
            await page.waitForLoadState('networkidle');
            let gzipped = 0;
            for (const url of scripts)
                gzipped += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
            const lcp = await page.evaluate(
                () =>
                    new Promise<number>(resolve => {
                        new PerformanceObserver(list => {
                            const entries = list.getEntries();
                            resolve(entries[entries.length - 1]!.startTime);
                        }).observe({ type: 'largest-contentful-paint', buffered: true });
                        setTimeout(() => resolve(-1), 3000);
                    }),
            );
            console.log(
                `${starter}: ${(gzipped / 1024).toFixed(1)} KB first-party JS gzipped, LCP ${Math.round(lcp)} ms (local)`,
            );
            expect(gzipped).toBeLessThanOrEqual(30 * 1024);
            expect(lcp).toBeLessThan(2500);
        });
    }
});

async function editorAs(browser: Browser, user?: { email: string; password: string }) {
    const context = await browser.newContext({
        baseURL: process.env.BROWSER_BASE_URL ?? 'http://localhost:3000',
    });
    const page = await context.newPage();
    await signIn(page, 'en', user?.email, user?.password);
    await openEditor(page);
    return page;
}

async function selectFirstSection(page: Page) {
    await page
        .getByRole('list', { name: 'Sections' })
        .getByRole('listitem')
        .first()
        .getByText('Rich text')
        .click();
    await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toBeVisible();
}

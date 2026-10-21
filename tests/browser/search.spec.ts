import { emptyProductForm, emptyVariant, takaToMinor } from '@ecommbd/shared';
import { devices, expect, type Page, test } from '@playwright/test';
import { signIn, watchForErrors } from './support/admin-ui';
import { adminSession, type ApiSession } from './support/store-api';
import { ensureStorefrontFixtures, type StorefrontFixtures } from './support/storefront-seed';

/**
 * Catalog browsing, search and filters (roadmap phase 13) on the storefront: Bangla, English,
 * synonyms and typos; filters with JavaScript on and off, on desktop and phone; suggestions with
 * the keyboard; searches with no results in the merchant admin; and server time on 500 products.
 */

const SITE = process.env.STOREFRONT_URL ?? 'http://localhost:4321';
const enc = (slug: string) => encodeURIComponent(slug.normalize('NFC'));

let admin: ApiSession;
let fixtures: StorefrontFixtures;
let men: string;

test.beforeAll(async () => {
    test.setTimeout(180_000);
    admin = await adminSession();
    fixtures = await ensureStorefrontFixtures(admin);
    men = `${SITE}/en/product-category/${fixtures.men.en}/`;
    // New products reach the search index through the worker.
    await expect
        .poll(async () => (await (await fetch(men)).text()).includes('class="card"'), { timeout: 60_000 })
        .toBe(true);
});

const productLink = (page: Page, slug: string) =>
    page.locator(`.product-grid a[href$="/product/${enc(slug)}/"]`);

test.describe('search', () => {
    test('finds the panjabi as "পাঞ্জাবি", "panjabi" (synonym) and "punjabi" (typo)', async ({ page }) => {
        for (const term of ['পাঞ্জাবি', 'panjabi', 'punjabi']) {
            await page.goto(`${SITE}/search/?q=${encodeURIComponent(term)}`);
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(`“${term}” এর ফলাফল`);
            await expect(productLink(page, fixtures.panjabi.bn), term).toBeVisible();
        }
        // On the English site too, with the English address.
        await page.goto(`${SITE}/en/search/?q=${encodeURIComponent('পাঞ্জাবি')}`);
        await expect(productLink(page, fixtures.panjabi.en)).toBeVisible();
    });

    test('says what a typo meant, and offers popular products when nothing matches', async ({ page }) => {
        await page.goto(`${SITE}/en/search/?q=panjbi`);
        await page.getByRole('link', { name: 'panjabi', exact: true }).click();
        await expect(page).toHaveURL(`${SITE}/en/search/?q=panjabi`);

        await page.goto(`${SITE}/en/search/?q=zzqqxw`);
        await expect(page.getByText('No results for “zzqqxw”')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Popular right now' })).toBeVisible();
        await expect(page.locator('.product-grid .card').first()).toBeVisible();
    });

    test('lists every product without words, and is never indexed', async ({ page }) => {
        const response = await page.goto(`${SITE}/en/search/`);
        expect(response?.headers()['x-robots-tag']).toBe('noindex');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('All products');
        await expect(page.locator('.product-grid .card')).toHaveCount(24);
        await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    });
});

test.describe('filters', () => {
    test('work without JavaScript: form, one canonical address, chips, noindex', async ({
        browser,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Desktop layout; the phone panel has its own test');
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(men);
        const all = await page.locator('.product-grid .card').count();
        await page.locator('input[name="filter.size"][value="l"]').check();
        await page.locator('#filters').getByRole('button', { name: 'Show results' }).click();
        // The form sends empty prices and the default order; one 301 cleans the address.
        await expect(page).toHaveURL(`${men}?filter.size=l`);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
        await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
        expect(await page.locator('.product-grid .card').count()).toBeLessThan(all);
        await expect(productLink(page, fixtures.panjabi.en)).toBeVisible();
        // The chip removes the filter.
        await page.getByRole('link', { name: 'Remove filter: Large' }).click();
        await expect(page).toHaveURL(men);
        await context.close();
    });

    test('fix a price range typed the wrong way round, and keep tracking parameters', async () => {
        const response = await fetch(`${men}?utm_source=fb&filter.price.min=2000&filter.price.max=500`, {
            redirect: 'manual',
        });
        expect(response.status).toBe(301);
        expect(response.headers.get('location')).toBe(
            '/en/product-category/sf-men/?filter.price.max=2000&filter.price.min=500&utm_source=fb',
        );
    });

    test('show how to remove filters when nothing matches', async ({ page }) => {
        await page.goto(`${men}?filter.price.max=1`);
        await expect(page.getByText('No products match these filters.')).toBeVisible();
        await page.locator('.empty-state').getByRole('link', { name: 'Clear all' }).click();
        await expect(page).toHaveURL(men);
    });

    test('apply at once with JavaScript on desktop, and sort', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'Desktop applies at once; phones use the panel');
        const errors = watchForErrors(page);
        await page.goto(men);
        await page.locator('input[name="filter.stock"]').check();
        await expect(page).toHaveURL(`${men}?filter.stock=in`);
        await page.getByLabel('Sort by').selectOption('price-asc');
        await expect(page).toHaveURL(`${men}?filter.stock=in&sort=price-asc`);
        const prices = await page
            .locator('.product-grid .price-now')
            .allTextContents()
            .then(texts => texts.map(text => Number(text.replace(/[^\d–]/g, '').split('–')[0])));
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
        expect(errors).toEqual([]);
    });

    test('open as a panel on phones, with and without JavaScript', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'Phone layout');
        for (const javaScriptEnabled of [true, false]) {
            const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
            const context = await browser.newContext({
                viewport,
                userAgent,
                deviceScaleFactor,
                isMobile,
                hasTouch,
                javaScriptEnabled,
            });
            const page = await context.newPage();
            await page.goto(men);
            const panel = page.locator('#filters');
            await expect(panel).toBeHidden();
            await page.getByRole('link', { name: 'Filters' }).click();
            await expect(panel).toBeVisible();
            await panel.locator('input[name="filter.size"][value="l"]').check();
            // Nothing applies until "Show results", so several filters can be chosen.
            await expect(page).toHaveURL(new RegExp(`^${men}(#filters)?$`));
            await panel.getByRole('button', { name: 'Show results' }).click();
            await expect(page).toHaveURL(`${men}?filter.size=l`);
            await expect(panel).toBeHidden();
            await context.close();
        }
    });
});

test.describe('suggestions', () => {
    test('appear as you type and work with the keyboard', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        const errors = watchForErrors(page);
        await page.goto(`${SITE}/en/`);
        // A searchbox until the script makes it a combobox on first focus.
        const box = page.locator('#search-q');
        await box.click();
        await box.pressSequentially('p');
        // One character: no suggestions.
        await expect(page.locator('#search-suggest')).toBeHidden();
        await box.pressSequentially('anj');
        const list = page.getByRole('listbox', { name: 'Search suggestions' });
        await expect(list).toBeVisible();
        await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
        await expect(list.getByRole('option').first()).toBeVisible();
        await box.press('ArrowDown');
        const first = list.getByRole('option').first();
        await expect(first).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('combobox')).toHaveAttribute('aria-activedescendant', 'search-option-0');
        await box.press('Escape');
        await expect(list).toBeHidden();
        await box.press('ArrowDown');
        await box.pressSequentially('i');
        await expect(list).toBeVisible();
        await box.press('ArrowDown');
        const href = await list.getByRole('option').first().getAttribute('href');
        await box.press('Enter');
        await expect(page).toHaveURL(`${SITE}${href}`);
        expect(errors).toEqual([]);
    });

    test('are a cacheable fragment, empty below two characters', async () => {
        const response = await fetch(`${SITE}/search/suggest/?q=p`);
        expect(response.status).toBe(200);
        expect((await response.text()).trim()).toBe('');
        const full = await fetch(`${SITE}/en/search/suggest/?q=${encodeURIComponent('পাঞ্জা')}`);
        expect(full.headers.get('cache-control')).toBe('public, max-age=60');
        expect(full.headers.get('x-robots-tag')).toBe('noindex');
        const html = await full.text();
        expect(html).not.toContain('<html');
        expect(html).toContain('role="option"');
    });
});

test.describe('merchant admin: Online store → Search', () => {
    test('lists searches with no results and adds a synonym that finds products', async ({
        page,
    }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough: both projects share the settings');
        const { bdSearchSettings: before } = await admin.query('{ bdSearchSettings }');
        const others = (before.synonyms as string[][]).filter(group => !group.includes('sherwani'));
        await admin.query(
            'mutation ($input: JSON!) { updateBdSearchSettings(input: $input) { errors { path } } }',
            {
                input: { synonyms: others },
            },
        );
        try {
            // A search nobody can satisfy yet.
            await fetch(`${SITE}/en/search/?q=sherwani`);
            const errors = watchForErrors(page);
            await signIn(page, 'en');
            await page.goto('/admin/store/search');
            await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
            const row = page.getByRole('row').filter({ hasText: 'sherwani' });
            await expect(row).toBeVisible();
            await row.getByRole('button', { name: 'Add as synonym' }).click();
            const groups = page.getByPlaceholder('panjabi, পাঞ্জাবি, punjabi');
            await groups.last().fill('sherwani, পাঞ্জাবি');
            await page.getByRole('button', { name: 'Save changes' }).click();
            await expect(
                page.getByRole('status').filter({ hasText: 'Search settings saved.' }),
            ).toBeVisible();
            expect(errors).toEqual([]);

            const shop = await (await fetch(`${SITE}/en/search/?q=sherwani`)).text();
            expect(shop).toContain(`/product/${fixtures.panjabi.en}/`);
        } finally {
            await admin.query(
                'mutation ($input: JSON!) { updateBdSearchSettings(input: $input) { errors { path } } }',
                {
                    input: { synonyms: before.synonyms },
                },
            );
        }
    });
});

test.describe('speed', () => {
    test('category and filter pages answer in under 200 ms on 500 products', async ({ browserName: _browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'One run is enough');
        test.setTimeout(600_000);
        const category = await ensurePerformanceProducts(admin);
        const base = `${SITE}/en/product-category/${category}/`;
        const pages = [
            base,
            `${base}?filter.size=m`,
            `${base}?filter.price.max=900&filter.size=l&filter.stock=in`,
            `${base}?page=3&sort=price-asc`,
        ];
        for (const url of pages) {
            await fetch(url); // warm up
            const times: number[] = [];
            for (let run = 0; run < 5; run++) {
                const started = performance.now();
                const response = await fetch(url);
                await response.text();
                expect(response.status, url).toBe(200);
                times.push(performance.now() - started);
            }
            const median = times.sort((a, b) => a - b)[2]!;
            testInfo.annotations.push({
                type: 'server time',
                description: `${url}: ${median.toFixed(0)} ms`,
            });
            console.log(`server time ${median.toFixed(0)} ms (median of 5): ${url.replace(SITE, '')}`);
            expect(median, url).toBeLessThan(200);
        }
        // Without the core's 3-second catalog cache: each request loads the catalog again.
        const cold: number[] = [];
        for (let run = 0; run < 3; run++) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            const started = performance.now();
            await (await fetch(pages[1]!)).text();
            cold.push(performance.now() - started);
        }
        const coldMedian = cold.sort((a, b) => a - b)[1]!;
        console.log(
            `server time ${coldMedian.toFixed(0)} ms (median of 3, catalog not cached): ${pages[1]!.replace(SITE, '')}`,
        );
        expect(coldMedian).toBeLessThan(200);
    });
});

/**
 * At least 500 enabled products in the store: the ones missing are made in a "Performance" category
 * (kept in the dev database), each with sizes S, M and L. Returns the category's English slug.
 */
async function ensurePerformanceProducts(api: ApiSession): Promise<string> {
    const shop = async () =>
        (
            await (
                await fetch(`${process.env.BROWSER_BASE_URL ?? 'http://localhost:3000'}/shop-api`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ query: '{ bdSearch(input: { take: 1 }) { totalItems } }' }),
                })
            ).json()
        ).data.bdSearch.totalItems as number;
    const { collections } = await api.query(
        '{ collections(options: { filter: { slug: { eq: "performance" } } }) { items { id slug } } }',
    );
    let categoryId: string = collections.items[0]?.id;
    if (!categoryId) {
        const { saveBdCategory } = await api.query(
            'mutation ($input: BdSaveCategoryInput!) { saveBdCategory(input: $input) { id } }',
            { input: { name: { bn: 'পারফরম্যান্স', en: 'Performance' } } },
        );
        categoryId = saveBdCategory.id;
    }
    const missing = 500 - (await shop());
    const sizes = ['S', 'M', 'L'];
    for (let start = 0; start < missing; start += 10) {
        await Promise.all(
            Array.from({ length: Math.min(10, missing - start) }, (_, offset) => {
                const n = start + offset;
                return api.query(
                    'mutation ($input: JSON!) { saveBdProduct(input: $input) { errors { path code } } }',
                    {
                        input: {
                            ...emptyProductForm(),
                            name: { bn: `নমুনা পণ্য ${n}`, en: `Sample item ${n}` },
                            categoryId,
                            variationType: 'size',
                            variants: sizes.map((size, index) => ({
                                ...emptyVariant(),
                                option: { bn: size, en: size },
                                price: takaToMinor(300 + (n % 40) * 25 + index * 50),
                                stock: n % 7 === 0 ? 0 : 5,
                                isDefault: index === 0,
                            })),
                        },
                    },
                );
            }),
        );
    }
    await expect.poll(shop, { timeout: 300_000, intervals: [2000] }).toBeGreaterThanOrEqual(500);
    const { collection } = await api.query(
        'query ($id: ID!) { collection(id: $id) { translations { languageCode slug } } }',
        {
            id: categoryId,
        },
    );
    return collection.translations.find((t: { languageCode: string }) => t.languageCode === 'en').slug;
}

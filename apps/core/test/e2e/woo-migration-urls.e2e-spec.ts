import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import {
    Collection,
    DefaultSearchPlugin,
    ProductTranslation,
    ProductVariant,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { encodeSlug } from '@ecommbd/shared';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMigrationOnlyObjects, createTestConfig, testInitialData } from '../support/test-config';
import { BdPage, BdPageTranslation } from '../../src/plugins/bd-content';
import { WooImportService } from '../../src/plugins/woo-import/woo-import.service';
import { WooRestConnector } from '../../src/plugins/woo-import/rest-connector';
import { WooRedirectService } from '../../src/plugins/woo-import/redirect.service';
import { WooIssue, WooRun } from '../../src/plugins/woo-import/entities';
import { WooExtra, WooMiss, WooRedirect } from '../../src/plugins/woo-import/helper-entities';
import { WooRecord } from '../../src/plugins/woo-import/helpers';

/**
 * Phases 21–22 review fixes, through the REST importer on a real Vendure and PostgreSQL:
 * Bangla slugs keep their address, links without a trailing slash import cleanly, one broken
 * record or a missing parent category no longer stops an import, a source outage stops it at the
 * right record and a resume finishes it, our order numbers continue after the last WooCommerce
 * number on a fresh store, and redirect rules respect the store's own pages and staff edits.
 */

registerInitializer('postgres', new PostgresInitializer());
const PORT = 3087;
const KEY = `v1:${Buffer.alloc(32, 9).toString('base64')}`;
const config = createTestConfig(
    PORT,
    {},
    { wooImportKeys: KEY, wooPublicUrl: 'https://destination.fixture.test' },
);
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: true }));
const { server, adminClient } = createTestEnvironment(config);

const SOURCE = 'https://woo.fixture.test';
// WordPress saves non-ASCII slugs percent-encoded, lowercase hex: this is what the REST API sends.
const wpEncode = (text: string) => encodeURIComponent(text).toLowerCase();
const SHIRT = 'লাল-শার্ট';
const CLOTHES = 'পোশাক';

const address = {
    first_name: 'Synthetic',
    last_name: 'Buyer',
    address_1: 'House 1 Road 2',
    address_2: '',
    city: 'Dhanmondi',
    state: 'BD-13',
    postcode: '1209',
    country: 'BD',
    email: 'buyer@example.com',
    phone: '01712345679',
};
function product(id: number, extra: WooRecord): WooRecord {
    return {
        id,
        type: 'simple',
        status: 'publish',
        name: `Synthetic product ${id}`,
        slug: `synthetic-${id}`,
        price: '990',
        regular_price: '990',
        sale_price: '',
        manage_stock: true,
        stock_quantity: 5,
        stock_status: 'instock',
        backorders: 'no',
        weight: '',
        dimensions: {},
        tax_status: 'none',
        virtual: false,
        downloadable: false,
        catalog_visibility: 'visible',
        attributes: [],
        default_attributes: [],
        categories: [],
        tags: [],
        images: [],
        sku: `SYN-${id}`,
        permalink: `${SOURCE}/product/synthetic-${id}/`,
        ...extra,
    };
}
const fixture: Record<string, WooRecord[]> = {
    categories: [
        {
            id: 10,
            name: CLOTHES,
            slug: wpEncode(CLOTHES),
            parent: 0,
            description: '',
            link: `${SOURCE}/shop-category/${wpEncode(CLOTHES)}/`,
        },
        // Its parent (99) is not in the store: the category must land at the top, with an issue.
        {
            id: 11,
            name: 'Orphan',
            slug: 'orphan',
            parent: 99,
            description: '',
            link: `${SOURCE}/shop-category/orphan/`,
        },
    ],
    tags: [],
    products: [
        // A Bangla slug, and a permalink without the trailing slash (WordPress `/%postname%`).
        product(100, {
            name: 'লাল শার্ট',
            slug: wpEncode(SHIRT),
            categories: [{ id: 10 }],
            permalink: `${SOURCE}/product/${wpEncode(SHIRT)}`,
        }),
        // Its variations can't be read: skipped with an issue, while the rest imports.
        product(101, { type: 'variable', manage_stock: false, attributes: [] }),
        // One variation has no price: left out, with a warning; the product still imports.
        product(102, {
            type: 'variable',
            manage_stock: false,
            attributes: [{ id: 0, name: 'Size', variation: true, options: ['M', 'L'] }],
        }),
    ],
    customers: [],
    orders: [
        {
            id: 7001,
            number: '5000',
            status: 'completed',
            currency: 'BDT',
            prices_include_tax: true,
            date_created_gmt: '2026-01-02T03:04:05',
            date_modified_gmt: '2026-01-02T03:04:05',
            customer_id: 0,
            discount_total: '0.00',
            shipping_total: '60.00',
            total: '1050.00',
            total_tax: '0.00',
            payment_method: 'cod',
            payment_method_title: 'Cash on delivery',
            fee_lines: [],
            coupon_lines: [],
            tax_lines: [],
            shipping_lines: [{ id: 1, method_title: 'Standard', total: '60.00', total_tax: '0.00' }],
            billing: address,
            shipping: address,
            line_items: [
                {
                    id: 1,
                    product_id: 100,
                    variation_id: 0,
                    quantity: 1,
                    subtotal: '990.00',
                    total: '990.00',
                    price: 990,
                    name: 'Red shirt',
                    sku: 'SYN-100',
                },
            ],
            refunds: [],
        },
    ],
};
const variations: Record<number, WooRecord[]> = {
    102: [
        {
            id: 1021,
            status: 'publish',
            price: '500',
            regular_price: '500',
            sku: 'SYN-102-M',
            manage_stock: false,
            stock_status: 'instock',
            attributes: [{ id: 0, name: 'Size', option: 'M' }],
        },
        {
            id: 1022,
            status: 'publish',
            price: '',
            regular_price: '',
            sku: 'SYN-102-L',
            manage_stock: false,
            stock_status: 'instock',
            attributes: [{ id: 0, name: 'Size', option: 'L' }],
        },
    ],
};

let db: TransactionalConnection;
let ctx: RequestContext;
let migration: WooImportService;
let redirects: WooRedirectService;
let sourceId: number;
/** When set, the old host is "down": every listing and child read fails. */
let sourceDown = false;
const raw = () => db.rawConnection;
const issuesOf = async (run: WooRun) =>
    (
        await raw()
            .getRepository(WooIssue)
            .findBy({ runId: Number(run.id) })
    ).map(issue => issue.code);

async function start(mode: 'dryRun' | 'import') {
    return migration.start(ctx, sourceId, mode, true);
}
async function finish(run: WooRun) {
    await migration.process(Number(run.id), ctx).catch(() => undefined);
    return raw().getRepository(WooRun).findOneByOrFail({ id: run.id });
}

describe('M5 review fixes: slugs, failures, order numbers and redirects', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
        await addMigrationOnlyObjects(server);
        db = server.app.get(TransactionalConnection);
        migration = server.app.get(WooImportService);
        redirects = server.app.get(WooRedirectService);
        // These scenarios call process() directly, so the worker must not race them.
        await migration['queue'].stop();
        const user = await raw()
            .getRepository(User)
            .findOneOrFail({ where: { identifier: 'superadmin' }, relations: { roles: { channels: true } } });
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
        vi.spyOn(WooRestConnector.prototype, 'inspectSettings').mockResolvedValue({
            currency: 'BDT',
            pricesIncludeTax: true,
            taxesEnabled: false,
            weightUnit: 'kg',
            wooVersion: '9.0.0',
            wordpressVersion: '6.6',
        });
        vi.spyOn(WooRestConnector.prototype, 'page').mockImplementation(async (kind, offset, size) => {
            if (sourceDown) throw new Error('SOURCE_NETWORK');
            return {
                records: structuredClone((fixture[kind] ?? []).slice(offset, offset + size)),
                size,
                total: (fixture[kind] ?? []).length,
            };
        });
        vi.spyOn(WooRestConnector.prototype, 'children').mockImplementation(async endpoint => {
            if (sourceDown) throw new Error('SOURCE_NETWORK');
            const [, id, child] = endpoint.split('/');
            if (child === 'variations' && id === '101') throw new Error('SOURCE_HTTP_500');
            if (child === 'variations') return structuredClone(variations[Number(id)] ?? []);
            return [];
        });
        // A store page that an old WordPress page maps to by its slug.
        await raw()
            .getRepository(BdPage)
            .save(
                new BdPage({
                    enabled: true,
                    translations: [
                        new BdPageTranslation({
                            languageCode: 'bn',
                            title: 'আমাদের কথা',
                            slug: 'about-us',
                            body: 'x',
                        }),
                    ],
                }),
            );
        const source = await migration.connect(ctx, {
            url: SOURCE,
            key: 'ck_' + 'a'.repeat(40),
            secret: 'cs_' + 'b'.repeat(40),
            imageHosts: [],
            pricesIncludeTax: true,
            weightUnit: 'kg',
        });
        sourceId = Number(source.id);
        // WordPress pages and Redirection-plugin rules, as the helper plugin delivers them.
        await raw()
            .getRepository(WooExtra)
            .save(
                new WooExtra({
                    sourceId,
                    kind: 'settings',
                    sourceKey: '1',
                    data: {
                        redirects: [
                            {
                                path: '/privacy-policy/',
                                target: '/',
                                status: 301,
                                page: { slug: 'privacy-policy' },
                            },
                            {
                                path: '/company/about-us/',
                                target: '/',
                                status: 301,
                                page: { slug: 'about-us' },
                            },
                            {
                                path: '/old-landing/',
                                target: '/',
                                status: 301,
                                page: { slug: 'old-landing' },
                            },
                            { path: '/', target: '/sale/', status: 301 },
                            { path: '/sitemap.xml', target: '/', status: 301 },
                        ],
                    },
                }),
            );
    }, 120000);
    afterAll(async () => {
        vi.restoreAllMocks();
        await server.destroy();
    });

    it('stops at the record where the source went down, and a resume imports the rest exactly once', async () => {
        // The dry run meets the unreadable record too (an error issue), so it needs review.
        expect((await finish(await start('dryRun'))).status).toBe('needsReview');
        const run = await start('import');
        // The host answers the categories, then goes down during the products.
        const page = vi.mocked(WooRestConnector.prototype.page);
        const original = page.getMockImplementation()!;
        page.mockImplementation(async function (this: WooRestConnector, kind, offset, size) {
            if (kind === 'products' && offset >= 1) sourceDown = true;
            return original.call(this, kind, offset, size);
        });
        const failed = await finish(run);
        expect(failed.status).toBe('failed');
        // Stopped at the second product (offset 1), not skipped past it.
        expect(failed.cursor).toMatchObject({ stage: 2, offset: 1 });
        expect(await issuesOf(failed)).not.toContain('SOURCE_RECORD_UNREADABLE');
        page.mockImplementation(original);
        sourceDown = false;
        await migration.resume(ctx, Number(run.id));
        const resumed = await finish(run);
        expect(['completed', 'needsReview']).toContain(resumed.status);
        expect(await raw().getRepository(ProductVariant).countBy({ sku: 'SYN-100' })).toBe(1);
    });

    it('skips one unreadable record and one unpriced variation, and keeps orphan categories', async () => {
        const run = await raw()
            .getRepository(WooRun)
            .findOneOrFail({ where: { sourceId, mode: 'import' }, order: { id: 'DESC' } });
        const codes = await issuesOf(run);
        expect(codes).toContain('SOURCE_RECORD_UNREADABLE');
        expect(codes).toContain('VARIATION_WITHOUT_PRICE_SKIPPED');
        expect(codes).toContain('CATEGORY_PARENT_MISSING');
        expect(run.counts.failed).toBe(1);
        // The broken record is the only one missing: the variable product with a price imported.
        expect(await raw().getRepository(ProductVariant).countBy({ sku: 'SYN-102-M' })).toBe(1);
        expect(await raw().getRepository(ProductVariant).countBy({ sku: 'SYN-102-L' })).toBe(0);
        const root = await raw().getRepository(Collection).findOneByOrFail({ isRoot: true });
        const orphan = await raw()
            .getRepository(Collection)
            .createQueryBuilder('c')
            .innerJoin('c.translations', 't', 't.slug = :slug', { slug: 'orphan' })
            .getOneOrFail();
        expect(String(orphan.parentId)).toBe(String(root.id));
    });

    it('keeps Bangla slugs as Bangla, and old links without a trailing slash need no rule', async () => {
        const translation = await raw()
            .getRepository(ProductTranslation)
            .findOneByOrFail({ slug: SHIRT.normalize('NFD'), languageCode: 'bn' as never });
        expect(translation.slug.normalize('NFC')).toBe(SHIRT);
        const target = `/product/${encodeSlug(SHIRT)}/`;
        // `/product/লাল-শার্ট` differs from our address only by the slash: the storefront serves
        // the product there itself, and saving a rule would have been a loop.
        expect(await raw().getRepository(WooRedirect).countBy({ sourceId })).toBeGreaterThan(0);
        expect(await redirects.resolve(ctx, `/product/${wpEncode(SHIRT)}`)).toBeNull();
        expect(await redirects.resolve(ctx, `/?p=100`)).toEqual({ status: 301, target });
        expect(await redirects.resolve(ctx, `/?product=${wpEncode(SHIRT)}`)).toEqual({ status: 301, target });
        expect(await redirects.resolve(ctx, `/shop-category/${wpEncode(CLOTHES)}/`)).toEqual({
            status: 301,
            target: `/product-category/${encodeSlug(CLOTHES)}/`,
        });
    });

    it('continues our order numbers after the last WooCommerce number on a fresh store', async () => {
        // Nothing has been ordered here yet, and the highest legacy number is 5000.
        const [{ next }] = await raw().query("SELECT nextval('bd_order_number_seq')::int AS next");
        expect(next).toBe(5001);
    });

    it('sends old pages to our page with the same address, and never takes over our own addresses', async () => {
        // Same address as our policy page: no rule, the storefront serves its own page there.
        expect(await redirects.resolve(ctx, '/privacy-policy/')).toBeNull();
        expect(await redirects.resolve(ctx, '/company/about-us/')).toEqual({
            status: 301,
            target: '/about-us/',
        });
        expect(await redirects.resolve(ctx, '/old-landing/')).toEqual({ status: 301, target: '/' });
        // A Redirection-plugin rule can't claim the home page or the sitemap; it's reported instead.
        expect(await raw().getRepository(WooRedirect).countBy({ path: '/' })).toBe(0);
        expect(await raw().getRepository(WooRedirect).countBy({ path: '/sitemap.xml' })).toBe(0);
        const run = await raw()
            .getRepository(WooRun)
            .findOneOrFail({ where: { sourceId, mode: 'import' }, order: { id: 'DESC' } });
        expect(await issuesOf(run)).toContain('REDIRECT_RULE_REQUIRES_REVIEW');
    });

    it('keeps staff rules through a re-import, and staff can delete a rule', async () => {
        const saved = await redirects.save(ctx, sourceId, '/old-landing/', '/about-us/');
        expect(saved.manual).toBe(true);
        const again = await finish(await start('import'));
        expect(['completed', 'needsReview']).toContain(again.status);
        expect(await redirects.resolve(ctx, '/old-landing/')).toEqual({ status: 301, target: '/about-us/' });
        const result = await adminClient.query<{ wooDeleteRedirect: boolean }>(
            gql`
                mutation ($id: ID!) {
                    wooDeleteRedirect(id: $id)
                }
            `,
            { id: saved.id },
        );
        expect(result.wooDeleteRedirect).toBe(true);
        expect(await redirects.resolve(ctx, '/old-landing/')).toBeNull();
    });

    it('never chains old links through a rule saved for one of our live pages', async () => {
        const product = `/product/${encodeSlug(SHIRT)}/`;
        await redirects.save(ctx, sourceId, '/old-shirt/', product);
        // A rule for the live product page never fires (the storefront serves the page)...
        await redirects.save(ctx, sourceId, product, '/');
        // ...so the old link must still lead to the product, not be re-pointed at the home page.
        expect(await redirects.resolve(ctx, '/old-shirt/')).toEqual({ status: 301, target: product });
        await redirects.save(ctx, sourceId, '/older-shirt/', product);
        expect(await redirects.resolve(ctx, '/older-shirt/')).toEqual({ status: 301, target: product });
    });

    it('lists real missing pages, ignores bot probes, and makes room when the list is full', async () => {
        await redirects.resolve(ctx, '/wp-login.php', true);
        await redirects.resolve(ctx, '/xmlrpc.php', true);
        await redirects.resolve(ctx, '/t-shirts/', true);
        await redirects.resolve(ctx, '/terms-and-conditions/', true);
        const paths = (await raw().getRepository(WooMiss).find()).map(miss => miss.path);
        expect(paths).toEqual(expect.arrayContaining(['/t-shirts/', '/terms-and-conditions/']));
        expect(paths).not.toContain('/wp-login.php');
        expect(paths).not.toContain('/xmlrpc.php');
        // Fill the list with one-hit junk, then a new miss still gets in.
        const channelId = Number(ctx.channelId);
        await raw().query(
            `INSERT INTO woo_miss ("channelId", path, hits, "createdAt", "updatedAt")
             SELECT $1, '/junk-' || g || '/', 1, now() - interval '1 day', now() - interval '1 day'
             FROM generate_series(1, 5000) g`,
            [channelId],
        );
        await redirects.resolve(ctx, '/t-shirts/', true);
        await redirects.resolve(ctx, '/a-real-broken-link/', true);
        const misses = raw().getRepository(WooMiss);
        expect(await misses.countBy({ channelId })).toBeLessThanOrEqual(5000);
        expect(await misses.countBy({ path: '/a-real-broken-link/' })).toBe(1);
        expect((await misses.findOneByOrFail({ path: '/t-shirts/' })).hits).toBe(2);
    });
});

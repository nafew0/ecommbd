import { RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';
import { isWooImportContext, markWooImportContext } from '../../src/plugins/woo-import/context';
import { wooSlug } from '../../src/plugins/woo-import/helpers';
import { isSupportedWordPressHash } from '../../src/plugins/woo-import/passwords';
import { nextPageSize, smallerPageSize } from '../../src/plugins/woo-import/rest-connector';
import { MISS_EXCLUDED, RESERVED_SOURCE, migrationPath } from '../../src/plugins/woo-import/urls';
import { estimateImportSeconds } from '../../src/plugins/woo-import/woo-import.service';

/** Phases 21–22 review fixes that need no database. */
describe('WooCommerce migration review fixes', () => {
    it("keeps the import mark on Vendure's copies of the context, and never on a fresh one", () => {
        const ctx = RequestContext.empty();
        expect(isWooImportContext(ctx)).toBe(false);
        markWooImportContext(ctx);
        // Event subscribers and transactions get `ctx.copy()`, which a WeakSet missed.
        expect(isWooImportContext(ctx.copy())).toBe(true);
        expect(isWooImportContext(ctx.copy().copy())).toBe(true);
        // A job's context is rebuilt from `serialize()`: it isn't quiet unless it marks itself.
        expect(isWooImportContext(RequestContext.deserialize(ctx.serialize()))).toBe(false);
        expect(isWooImportContext(RequestContext.empty())).toBe(false);
        expect(isWooImportContext(undefined)).toBe(false);
    });

    it('decodes percent-encoded WordPress slugs, as Vendure stores them', () => {
        const shirt = 'লাল-শার্ট';
        expect(wooSlug(encodeURIComponent(shirt).toLowerCase())).toBe(shirt.normalize('NFD'));
        expect(wooSlug('Cotton-Panjabi')).toBe('cotton-panjabi');
        // A stray % that isn't an escape keeps the rest of the text.
        expect(wooSlug('50%-off')).toBe('50-off');
        expect(wooSlug(undefined)).toBe('');
    });

    it('steps page sizes down on trouble and back up after a good page', () => {
        expect([100, 50, 20].map(smallerPageSize)).toEqual([50, 20, 10]);
        expect(smallerPageSize(10)).toBe(10);
        expect([10, 20, 50].map(nextPageSize)).toEqual([20, 50, 100]);
        expect(nextPageSize(100)).toBe(100);
    });

    it("refuses rules that would claim the store's own addresses, with exact boundaries", () => {
        const reserved = (path: string) => RESERVED_SOURCE.test(migrationPath(path));
        for (const path of ['/', '/?utm_source=x', '/sitemap.xml', '/sitemap-products.xml', '/robots.txt'])
            expect(reserved(path), path).toBe(true);
        for (const path of ['/admin/', '/account/', '/search/?q=x', '/t/abc/', '/checkout/', '/s/offer/'])
            expect(reserved(path), path).toBe(true);
        // Old addresses that merely start with the same letters, and WordPress query links.
        for (const path of [
            '/t-shirts/',
            '/terms-and-conditions/',
            '/tag/sale/',
            '/shop/',
            '/?p=12',
            '/?product=x',
        ])
            expect(reserved(path), path).toBe(false);
    });

    it('leaves bot probes out of the missing-pages list', () => {
        const excluded = (path: string) => MISS_EXCLUDED.test(migrationPath(path));
        for (const path of ['/wp-login.php', '/xmlrpc.php', '/wp-admin/', '/.env', '/old/shell.php'])
            expect(excluded(path), path).toBe(true);
        for (const path of ['/t-shirts/', '/tag/sale/', '/wp-content/uploads/2024/01/photo.jpg'])
            expect(excluded(path), path).toBe(false);
    });

    it('refuses imported hashes whose work factor would burn CPU on every login', () => {
        const salt = 'A'.repeat(53);
        expect(isSupportedWordPressHash(`$2y$10$${salt}`)).toBe(true);
        expect(isSupportedWordPressHash(`$wp$2y$13$${salt}`)).toBe(true);
        expect(isSupportedWordPressHash(`$2y$14$${salt}`)).toBe(false);
        // phpass: the 4th character is the log2 round count ('B' = 13, WordPress's own).
        expect(isSupportedWordPressHash('$P$B' + 'a'.repeat(30))).toBe(true);
        expect(isSupportedWordPressHash('$P$I' + 'a'.repeat(30))).toBe(false); // 'I' = 2^20
    });

    it('estimates an import from the dry run: reading time, writes and images', () => {
        const startedAt = new Date(Date.now() - 60_000).toISOString();
        const seconds = estimateImportSeconds({
            counts: { products: 100, customers: 500, orders: 2000 },
            verification: { startedAt, imageCount: 300 },
        });
        // 60 s of reading + 30 + 10 + 20 s of writes + 600 s of images.
        expect(seconds).toBeGreaterThanOrEqual(720);
        expect(seconds).toBeLessThan(725);
        expect(estimateImportSeconds({ counts: {}, verification: {} })).toBe(0);
    });
});

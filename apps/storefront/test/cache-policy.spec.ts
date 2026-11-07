import { describe, expect, it } from 'vitest';
import { pageTags, privateRequest, tagResponse } from '../src/lib/cache-policy';

const tagsOf = (response: Response) => response.headers.get('xkey')?.split(' ') ?? [];
const page = (path: string, xkey?: string, init: ResponseInit = {}) =>
    tagResponse(
        new Response('public', {
            ...init,
            headers: { ...(xkey !== undefined ? { xkey } : {}), ...init.headers },
        }),
        new Request('http://shop.test' + path),
        'store17',
    );

describe('which requests stay private', () => {
    it('keeps personal, disguised, preview and authenticated requests out of the cache', () => {
        for (const path of [
            '/cart/',
            '/en/checkout/',
            '/account/x.css',
            '/%61ccount/x.css',
            '/t/secret',
            '/s/honey/order/',
            '/s/honey/thank-you/',
            '/?pre%76iew=abc',
        ]) {
            expect(privateRequest(new Request('http://shop.test' + path))).toBe(true);
        }
        const withHeaders = (headers: Record<string, string>) =>
            privateRequest(new Request('http://shop.test/product/x/', { headers }));
        expect(withHeaders({ cookie: 'shop-session=secret' })).toBe(true);
        expect(withHeaders({ authorization: 'Bearer x' })).toBe(true);
        expect(withHeaders({ cookie: 'utm_attribution=x; cart_count=2' })).toBe(false);
        expect(privateRequest(new Request('http://shop.test/product/x/', { method: 'POST' }))).toBe(true);
    });

    it('marks private answers no-store, without tags', () => {
        const response = tagResponse(
            new Response('personal'),
            new Request('http://shop.test/cart/'),
            'store17',
        );
        expect(response.headers.get('xkey')).toBeNull();
        expect(response.headers.get('x-cache-store')).toBeNull();
        expect(response.headers.get('cache-control')).toBe('no-store');
        const marked = page('/product/x/', 'product:1', {
            headers: { 'cache-control': 'private, max-age=3600' },
        });
        expect(marked.headers.get('cache-control')).toBe('no-store');
        expect(marked.headers.get('xkey')).toBeNull();
    });
});

describe('cache tags', () => {
    it('tag a product page with its product and the site-wide tags, not the catalog at large', () => {
        const tags = tagsOf(page('/product/x/', 'layouts layout:3 product:42 collection:7'));
        expect(tags).toEqual(
            expect.arrayContaining([
                'store17:store',
                'store17:settings',
                'store17:theme',
                'store17:menus',
                'store17:type:product',
                'store17:product:42',
                'store17:collection:7',
                // Any page showing a product, for changes that don't say which (tax, facets).
                'store17:products',
            ]),
        );
        expect(tags).not.toContain('store17:listing');
        expect(tags).not.toContain('store17:pages');
    });

    it('leave content pages out of catalog purges', () => {
        const tags = tagsOf(page('/about-us/', 'pages page:5'));
        expect(tags).toContain('store17:pages');
        for (const catalog of ['listing', 'products', 'collections'])
            expect(tags).not.toContain(`store17:${catalog}`);
    });

    it('give a page that names no tags every catalog and content tag', () => {
        expect(pageTags('page', null)).toEqual(
            expect.arrayContaining(['listing', 'products', 'pages', 'layouts', 'sales-pages', 'collections']),
        );
    });

    it('add what the header shows, from the middleware', () => {
        const response = tagResponse(
            new Response('public', { headers: { xkey: 'pages' } }),
            new Request('http://shop.test/about-us/'),
            'store17',
            false,
            ['collections'],
        );
        expect(tagsOf(response)).toContain('store17:collections');
    });

    it('fit the header: too many entity tags give way to the broad ones', () => {
        const many = Array.from({ length: 200 }, (_, i) => `product:${i}`).join(' ');
        const tags = tagsOf(page('/product/x/', `listing ${many}`));
        expect(tags.length).toBeLessThanOrEqual(100);
        expect(tags).toEqual(
            expect.arrayContaining(['store17:store', 'store17:listing', 'store17:products']),
        );
        expect(tags.some(tag => tag.startsWith('store17:product:'))).toBe(false);
        const long = Array.from({ length: 90 }, (_, i) => 'product:' + String(i).padEnd(70, 'x')).join(' ');
        const worst = tagResponse(
            new Response('public', { headers: { xkey: long } }),
            new Request('http://shop.test/product/x/'),
            's'.repeat(48),
        );
        expect(worst.headers.get('xkey')!.length).toBeLessThanOrEqual(6000);
        expect(tagsOf(worst)).toContain(`${'s'.repeat(48)}:listing`);
    });

    it('drop malformed tags', () => {
        const tags = tagsOf(page('/product/x/', 'product:1 bad"tag'));
        expect(tags).toContain('store17:product:1');
        expect(tags).not.toContain('store17:bad"tag');
    });

    it('keep 404s a minute and pages a week, revalidated by browsers', () => {
        expect(page('/product/x/', 'listing').headers.get('cache-control')).toBe(
            'public, max-age=0, s-maxage=604800, must-revalidate',
        );
        expect(page('/product/missing/', 'listing', { status: 404 }).headers.get('cache-control')).toBe(
            'public, max-age=0, s-maxage=60, must-revalidate',
        );
        // A page's own short policy stands (search suggestions: a minute).
        expect(
            page('/search/suggest/', 'listing', {
                headers: { 'cache-control': 'public, max-age=60' },
            }).headers.get('cache-control'),
        ).toBe('public, max-age=60');
    });
});

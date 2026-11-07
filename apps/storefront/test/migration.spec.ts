import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLegacyQueryLink, legacyRedirect, legacyUrl } from '../src/lib/migration';

/** Old WooCommerce links after a migration (phases 21–22). */
describe('old store links', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("looks up WordPress's query links before routing, and nothing else", () => {
        expect(isLegacyQueryLink(new URLSearchParams('p=123'))).toBe(true);
        expect(isLegacyQueryLink(new URLSearchParams('product=lal-shirt'))).toBe(true);
        expect(isLegacyQueryLink(new URLSearchParams('attachment_id=9'))).toBe(true);
        // Our own query strings (search, filters, tracking) are never treated as old links.
        expect(isLegacyQueryLink(new URLSearchParams('q=shirt&page=2&utm_source=fb'))).toBe(false);
    });

    it('answers a 301 or 410 that no shared cache keeps, and never a loop', () => {
        const moved = legacyRedirect({ status: 301, target: '/product/a/' }, '/item/a/')!;
        expect(moved.status).toBe(301);
        expect(moved.headers.get('location')).toBe('/product/a/');
        expect(moved.headers.get('cache-control')).toBe('private, max-age=3600');
        expect(legacyRedirect({ status: 410, target: null }, '/feed/')!.status).toBe(410);
        expect(legacyRedirect({ status: 301, target: '/same/' }, '/same/')).toBeNull();
        expect(legacyRedirect(null, '/missing/')).toBeNull();
    });

    it('keeps the page when the lookup fails, instead of showing "unavailable"', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
        expect(await legacyUrl('/old/', true)).toBeNull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })));
        expect(await legacyUrl('/old/')).toBeNull();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ errors: [{ message: 'boom' }] })));
        expect(await legacyUrl('/old/')).toBeNull();
        // The failure is logged without the path, which can carry tracking or personal data.
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('/old/');
    });

    it('returns the rule the core found', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(
                Response.json({ data: { wooResolvePath: { status: 301, target: '/product/a/' } } }),
            );
        vi.stubGlobal('fetch', fetch);
        expect(await legacyUrl('/item/a/', true)).toEqual({ status: 301, target: '/product/a/' });
        expect(JSON.parse(fetch.mock.calls[0][1].body).variables).toEqual({
            path: '/item/a/',
            recordMiss: true,
        });
    });
});

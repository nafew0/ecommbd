import { describe, it, expect } from 'vitest';
import { privateRequest, tagResponse } from '../src/lib/cache-policy';
describe('full-page cache safety', () => {
    it('keeps personal, disguised, preview and authenticated requests private', () => {
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
        expect(
            privateRequest(
                new Request('http://shop.test/product/x/', { headers: { cookie: 'shop-session=secret' } }),
            ),
        ).toBe(true);
        expect(
            privateRequest(
                new Request('http://shop.test/product/x/', { headers: { authorization: 'Bearer x' } }),
            ),
        ).toBe(true);
        expect(
            privateRequest(
                new Request('http://shop.test/product/x/', {
                    headers: { cookie: 'utm_attribution=x; cart_count=2' },
                }),
            ),
        ).toBe(false);
    });
    it('bounds dependency headers without losing the store-wide fallback', () => {
        const response = tagResponse(
            new Response('public', {
                headers: { xkey: Array.from({ length: 200 }, (_, i) => 'product:' + i).join(' ') },
            }),
            new Request('http://shop.test/product/x/'),
            'store17',
        );
        const tags = response.headers.get('xkey')!.split(' ');
        expect(tags).toHaveLength(100);
        expect(tags).toContain('store17:store');
        expect(tags).toContain('store17:catalog');
        const privateResponse = tagResponse(
            new Response('personal'),
            new Request('http://shop.test/cart/'),
            'store17',
        );
        expect(privateResponse.headers.get('xkey')).toBeNull();
        expect(privateResponse.headers.get('cache-control')).toBe('no-store');
        const worst = tagResponse(
            new Response('public', {
                headers: {
                    xkey: Array.from({ length: 200 }, (_, i) => 'product:' + String(i).padEnd(70, 'x')).join(
                        ' ',
                    ),
                },
            }),
            new Request('http://shop.test/product/x/'),
            's'.repeat(48),
        );
        expect(worst.headers.get('xkey')!.length).toBeLessThanOrEqual(6000);
    });
});

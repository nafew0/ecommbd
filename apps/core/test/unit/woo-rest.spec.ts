import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@ecommbd/shared', async importOriginal => ({
    ...(await importOriginal<typeof import('@ecommbd/shared')>()),
    createHttpClient: () => mocks,
}));
import { WooRestConnector } from '../../src/plugins/woo-import/rest-connector';
describe('Woo REST traversal', () => {
    it('shrinks batches without moving the absolute offset, keeping auth out of URLs', async () => {
        const urls: URL[] = [];
        mocks.request.mockImplementation(async (url: URL) => {
            urls.push(new URL(url));
            return urls.length < 4
                ? { status: 503 }
                : { status: 200, headers: new Headers({ 'x-wp-total': '130' }), json: () => [{ id: 126 }] };
        });
        const connector = new WooRestConnector('https://source.example', {
            key: 'ck_secret',
            secret: 'cs_secret',
        });
        const page = await connector.page('orders', 125, 100, null, new Date('2026-10-21T00:00:00Z'));
        expect(page.size).toBe(10);
        expect(page.total).toBe(130);
        expect(urls.map(u => u.searchParams.get('per_page'))).toEqual(['100', '50', '20', '10']);
        expect(
            urls.every(
                u =>
                    u.searchParams.get('offset') === '125' &&
                    !u.href.includes('secret') &&
                    u.pathname === '/wp-json/wc/v3/orders',
            ),
        ).toBe(true);
        expect(urls[0].searchParams.get('dates_are_gmt')).toBe('true');
        await connector.close();
    });
    it('reads order notes in one request, even when an order has more than 100', async () => {
        // WooCommerce's notes endpoint ignores per_page and offset: it always answers every note.
        const notes = Array.from({ length: 140 }, (_, i) => ({ id: i + 1 }));
        mocks.request.mockReset();
        mocks.request.mockResolvedValue({ status: 200, headers: new Headers(), json: () => notes });
        const connector = new WooRestConnector('https://source.example', { key: 'ck_a', secret: 'cs_b' });
        expect(await connector.children('orders/7/notes')).toHaveLength(140);
        expect(mocks.request).toHaveBeenCalledTimes(1);
        // Any other endpoint that ignores offset stops at the first page made only of repeats.
        mocks.request.mockReset();
        mocks.request.mockResolvedValue({
            status: 200,
            headers: new Headers(),
            json: () => notes.slice(0, 100),
        });
        expect(await connector.children('products/7/variations')).toHaveLength(100);
        expect(mocks.request).toHaveBeenCalledTimes(2);
        await connector.close();
    });
    it('stops on blocked authentication and does not follow redirects with credentials', async () => {
        mocks.request.mockResolvedValue({ status: 403 });
        const connector = new WooRestConnector('https://source.example', {
            key: 'ck_test',
            secret: 'cs_test',
        });
        await expect(connector.page('products', 0, 100)).rejects.toThrow('SOURCE_AUTH_OR_FIREWALL');
        mocks.request.mockResolvedValue({ status: 302 });
        await expect(connector.page('products', 0, 100)).rejects.toThrow('SOURCE_HTTP_302');
        await connector.close();
    });
});

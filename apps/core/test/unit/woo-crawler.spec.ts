import { describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@ecommbd/shared', async original => ({
    ...(await original<typeof import('@ecommbd/shared')>()),
    createHttpClient: () => network,
}));
import { RequestContext } from '@vendure/core';
import { WooRedirectService } from '../../src/plugins/woo-import/redirect.service';
import { WooSource } from '../../src/plugins/woo-import/entities';
const service = new WooRedirectService({} as never);
const ctx = RequestContext.empty();
const source = new WooSource({ id: 1, url: 'https://old.example' });
const response = (status: number, body = '', location?: string) => ({
    status,
    body: Buffer.from(body),
    headers: new Headers(location ? { location } : {}),
});
describe('migration sitemap verification', () => {
    it('accepts 200 or a single local 301 and detects broken URLs and redirect chains', async () => {
        network.request.mockImplementation(async (input: URL | string) => {
            const url = new URL(input);
            if (url.origin === 'https://old.example')
                return response(
                    200,
                    '<urlset><url><loc>https://old.example/ok/</loc></url><url><loc>https://old.example/moved/</loc></url><url><loc>https://old.example/CHAIN/</loc></url><url><loc>https://old.example/missing/</loc></url></urlset>',
                );
            if (url.pathname === '/moved/') return response(301, '', '/ok/');
            if (url.pathname === '/CHAIN/') return response(301, '', '/chain/');
            if (url.pathname === '/chain/') return response(301, '', '/moved/');
            return response(url.pathname === '/ok/' ? 200 : 404);
        });
        const crawl = await service.crawl(
            ctx,
            source,
            'https://new.example',
            'https://old.example/sitemap.xml',
        );
        expect(crawl.checked).toBe(4);
        expect(crawl.passed).toBe(false);
        expect(crawl.results.map(row => row.ok)).toEqual([true, true, false, false]);
    });
    it('rejects unsafe XML and foreign sitemap input and never follows an external page redirect', async () => {
        await expect(
            service.crawl(ctx, source, 'https://new.example', 'https://foreign.example/sitemap.xml'),
        ).rejects.toThrow();
        network.request.mockResolvedValue(
            response(200, '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><urlset/>'),
        );
        await expect(
            service.crawl(ctx, source, 'https://new.example', 'https://old.example/sitemap.xml'),
        ).rejects.toThrow('UNSAFE_SITEMAP');
        const hosts: string[] = [];
        network.request.mockImplementation(async (input: URL | string) => {
            const url = new URL(input);
            hosts.push(url.hostname);
            return url.hostname === 'old.example'
                ? response(200, '<urlset><url><loc>https://old.example/escape/</loc></url></urlset>')
                : response(301, '', 'https://evil.example/');
        });
        const result = await service.crawl(
            ctx,
            source,
            'https://new.example',
            'https://old.example/sitemap.xml',
        );
        expect(result.passed).toBe(false);
        expect(hosts).toEqual(['old.example', 'new.example']);
    });
});

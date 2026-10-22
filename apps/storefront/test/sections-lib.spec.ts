import { describe, expect, it } from 'vitest';
import { collectionPath, linkHref } from '../src/lib/sections';
import type { StoreSettings } from '../src/lib/store';

const settings = { profile: { whatsapp: '+8801712345678', phones: ['+8801812345678'] } } as unknown as StoreSettings;
const context = { lang: 'en' as const, defaultLang: 'bn' as const, settings };

describe('section links on the storefront (phase 15)', () => {
    it('puts store paths in the page’s language and leaves anchors and web addresses as they are', () => {
        expect(linkHref({ type: 'search', href: '/search/' }, context)).toBe('/en/search/');
        expect(linkHref({ type: 'search', href: '/search/' }, { ...context, lang: 'bn' })).toBe('/search/');
        expect(linkHref({ type: 'anchor', anchor: 'faq', href: '#faq' }, context)).toBe('#faq');
        expect(linkHref({ type: 'url', url: 'https://example.com', href: 'https://example.com' }, context)).toBe(
            'https://example.com',
        );
    });

    it('builds WhatsApp and call links from store settings, and nothing for links without an address', () => {
        expect(linkHref({ type: 'whatsapp' }, context)).toBe('https://wa.me/8801712345678');
        expect(linkHref({ type: 'call' }, context)).toBe('tel:+8801812345678');
        const empty = { ...settings, profile: { whatsapp: '', phones: [] } } as unknown as StoreSettings;
        expect(linkHref({ type: 'whatsapp' }, { ...context, settings: empty })).toBeNull();
        expect(linkHref({ type: 'call' }, { ...context, settings: empty })).toBeNull();
        expect(linkHref({ type: 'none' }, context)).toBeNull();
        // A category that's gone: the core sent no address.
        expect(linkHref({ type: 'category', ref: '9' }, context)).toBeNull();
    });

    it('makes category paths from breadcrumbs, without Vendure’s hidden root', () => {
        expect(
            collectionPath({
                id: '3',
                name: 'Panjabi',
                featuredAsset: null,
                breadcrumbs: [{ slug: '__root_collection__' }, { slug: 'men' }, { slug: 'পাঞ্জাবি' }],
            }),
        ).toBe(`/product-category/men/${encodeURIComponent('পাঞ্জাবি')}/`);
    });
});

import { describe, expect, it } from 'vitest';
import { formatter, otherLang, t } from '../src/lib/i18n';
import { imageAttributes, largestImageUrl } from '../src/lib/images';
import { breadcrumbList, jsonLd, metaDescription, organization, product, website } from '../src/lib/seo';

describe('JSON-LD', () => {
    it('can never end its script element', () => {
        const json = jsonLd({ name: '</script><script>alert(1)</script> & \u2028' });
        expect(json).not.toContain('</script>');
        expect(json).not.toContain('<');
        expect(json).toContain('\\u003c/script\\u003e');
        expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script> & \u2028' });
    });

    it('describes a product with one Offer per variant, in taka', () => {
        const data = product({
            name: 'Panjabi',
            url: 'https://shop.example/product/panjabi/',
            description: '<p>Soft <b>cotton</b></p>',
            images: ['https://shop.example/img/a/1600.webp'],
            variants: [
                { sku: 'P-M', priceWithTax: 125000, stockLevel: 'IN_STOCK' },
                { sku: '', priceWithTax: 145050, stockLevel: 'OUT_OF_STOCK' },
            ],
            brand: 'Rahim Fashion',
        });
        expect(data).toMatchObject({
            '@type': 'Product',
            description: 'Soft cotton',
            image: ['https://shop.example/img/a/1600.webp'],
            sku: 'P-M',
            brand: { '@type': 'Brand', name: 'Rahim Fashion' },
        });
        expect(data.offers).toEqual([
            {
                '@type': 'Offer',
                url: 'https://shop.example/product/panjabi/',
                sku: 'P-M',
                priceCurrency: 'BDT',
                price: '1250.00',
                availability: 'https://schema.org/InStock',
                itemCondition: 'https://schema.org/NewCondition',
            },
            {
                '@type': 'Offer',
                url: 'https://shop.example/product/panjabi/',
                priceCurrency: 'BDT',
                price: '1450.50',
                availability: 'https://schema.org/OutOfStock',
                itemCondition: 'https://schema.org/NewCondition',
            },
        ]);
    });

    it('leaves out the image and description when there are none', () => {
        const data = product({
            name: 'Lungi',
            url: 'u',
            description: '',
            images: [],
            variants: [],
            brand: 'b',
        });
        expect(data).not.toHaveProperty('image');
        expect(data).not.toHaveProperty('description');
        expect(data).not.toHaveProperty('sku');
    });

    it('builds breadcrumbs, the organization and the search box', () => {
        expect(breadcrumbList([{ name: 'হোম', url: 'https://s/' }]).itemListElement).toEqual([
            { '@type': 'ListItem', position: 1, name: 'হোম', item: 'https://s/' },
        ]);
        expect(
            organization({
                name: 'Shop',
                url: 'https://s/',
                phones: ['+8801712345678'],
                email: '',
                sameAs: [],
            }),
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Shop',
            url: 'https://s/',
            contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'customer service',
                telephone: '+8801712345678',
                areaServed: 'BD',
            },
        });
        expect(organization({ name: 'S', url: 'u', phones: [], email: '', sameAs: [] })).not.toHaveProperty(
            'contactPoint',
        );
        expect(
            website({ name: 'S', url: 'https://s/', searchUrl: 'https://s/search/', language: 'bn' })
                .potentialAction,
        ).toEqual({
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: 'https://s/search/?q={search_term_string}' },
            'query-input': 'required name=search_term_string',
        });
    });

    it('uses the merchant’s SEO description, else the start of the text', () => {
        expect(metaDescription(' Custom ', '<p>Body</p>')).toBe('Custom');
        expect(metaDescription(null, '<p>Body</p><p>Two</p>')).toBe('Body Two');
    });
});

describe('formatting', () => {
    it('shows Bangla digits only on Bangla pages with the setting on', () => {
        expect(formatter('bn', true).priceRange(50000, 90000)).toBe('৳৫০০ – ৳৯০০');
        expect(formatter('bn', false).price(125000)).toBe('৳1,250');
        expect(formatter('en', true).price(125000)).toBe('৳1,250');
        expect(formatter('bn', true).priceRange(50000, 50000)).toBe('৳৫০০');
        expect(formatter('bn', true).number(12)).toBe('১২');
        expect(formatter('en', true).number(12)).toBe('12');
    });

    it('has both languages, with plurals', () => {
        expect(t('en').products(1)).toBe('1 product');
        expect(t('en').products(3)).toBe('3 products');
        expect(t('bn').products(3)).toBe('৩টি পণ্য');
        expect(t('bn').pageOf(2, 5)).toBe('পাতা ২ / ৫');
        expect(otherLang('bn')).toBe('en');
        expect(Object.keys(t('bn')).sort()).toEqual(Object.keys(t('en')).sort());
    });
});

describe('images', () => {
    const asset = (bdImage: unknown) => ({
        id: '1',
        name: 'x',
        preview: 'http://localhost:3000/assets/preview/ab/x.jpg',
        width: 1200,
        height: 900,
        customFields: { bdImage },
    });

    it('uses the WebP sizes when they’re ready', () => {
        const ready = asset({
            status: 'ready',
            width: 1200,
            height: 900,
            srcset: '/img/h/160.webp 160w, /img/h/480.webp 480w, /img/h/1200.webp 1200w',
            variants: [
                { width: 160, height: 120, url: '/img/h/160.webp' },
                { width: 480, height: 360, url: '/img/h/480.webp' },
                { width: 1200, height: 900, url: '/img/h/1200.webp' },
            ],
        });
        expect(imageAttributes(ready as never)).toEqual({
            src: '/img/h/480.webp',
            srcset: '/img/h/160.webp 160w, /img/h/480.webp 480w, /img/h/1200.webp 1200w',
            width: 1200,
            height: 900,
        });
        expect(imageAttributes(ready as never, 2000).src).toBe('/img/h/1200.webp');
        expect(largestImageUrl(ready as never)).toBe('/img/h/1200.webp');
    });

    it('falls back to Vendure’s preview, from the store’s own origin', () => {
        const pending = asset({ status: 'pending', width: 0, height: 0, srcset: '', variants: [] });
        expect(imageAttributes(pending as never)).toEqual({
            src: '/assets/preview/ab/x.jpg?w=960',
            width: 1200,
            height: 900,
        });
        expect(largestImageUrl(asset(null) as never)).toBe('/assets/preview/ab/x.jpg');
    });
});

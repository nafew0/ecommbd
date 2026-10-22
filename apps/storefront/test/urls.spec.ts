import { describe, expect, it } from 'vitest';
import {
    categoryPath,
    localePath,
    lookupSlug,
    normalizePath,
    pagePath,
    parseLocalePath,
    productPath,
    sameOriginAssetUrl,
} from '../src/lib/urls';

const SAREE = 'শাড়ি';
const MOTA = 'মোটা'; // ো: one character composed (NFC), two decomposed (NFD)

describe('normalizePath', () => {
    it('adds the trailing slash, lowercases and drops empty segments', () => {
        expect(normalizePath('/Product/Silk-Saree')).toBe('/product/silk-saree/');
        expect(normalizePath('//product///x//')).toBe('/product/x/');
        expect(normalizePath('/')).toBe('/');
        expect(normalizePath('')).toBe('/');
    });

    it('keeps the case of a tracking token, and only that', () => {
        expect(normalizePath('/T/LYnHXnW3hzq1p8Cvpsy9bQ')).toBe('/t/LYnHXnW3hzq1p8Cvpsy9bQ/');
        expect(normalizePath('/en/T/AbC')).toBe('/en/t/abc/');
        expect(normalizePath('/Product/AbC/')).toBe('/product/abc/');
    });

    it('leaves file paths without a slash', () => {
        expect(normalizePath('/sitemap.xml')).toBe('/sitemap.xml');
        expect(normalizePath('/Robots.TXT')).toBe('/robots.txt');
    });

    it('gives one spelling for every encoding of a Bangla slug', () => {
        const canonical = `/product/${encodeURIComponent(MOTA.normalize('NFC'))}/`;
        const spellings = [
            `/product/${encodeURIComponent(MOTA.normalize('NFD'))}`,
            `/product/${encodeURIComponent(MOTA.normalize('NFC'))}/`,
            `/product/${encodeURIComponent(MOTA)}/`.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()),
            `/product/${MOTA.normalize('NFD')}/`,
        ];
        for (const spelling of spellings) expect(normalizePath(spelling)).toBe(canonical);
    });

    it('keeps a segment with broken percent-encoding as it came', () => {
        expect(normalizePath('/product/%E0%A6/')).toBe('/product/%25e0%25a6/');
    });
});

describe('language prefixes', () => {
    it('reads the prefix, or the default language', () => {
        expect(parseLocalePath('/en/product/x', 'bn')).toEqual({ lang: 'en', path: '/product/x/' });
        expect(parseLocalePath('/EN/', 'bn')).toEqual({ lang: 'en', path: '/' });
        expect(parseLocalePath('/product/x/', 'bn')).toEqual({ lang: 'bn', path: '/product/x/' });
        expect(parseLocalePath('/bn/terms/', 'en')).toEqual({ lang: 'bn', path: '/terms/' });
        expect(parseLocalePath('/english-books/', 'bn')).toEqual({ lang: 'bn', path: '/english-books/' });
    });

    it('writes paths with the prefix only for the other language', () => {
        expect(localePath('bn', 'bn', '/product/x/')).toBe('/product/x/');
        expect(localePath('en', 'bn', '/product/x/')).toBe('/en/product/x/');
        expect(localePath('en', 'bn', '/')).toBe('/en/');
        expect(localePath('bn', 'en', '/')).toBe('/bn/');
    });
});

describe('entity paths and slugs', () => {
    it('writes WooCommerce-style paths, NFC-encoded', () => {
        expect(productPath('silk-saree')).toBe('/product/silk-saree/');
        expect(productPath(SAREE.normalize('NFD'))).toBe(
            `/product/${encodeURIComponent(SAREE.normalize('NFC'))}/`,
        );
        expect(categoryPath(['women', 'saree'])).toBe('/product-category/women/saree/');
        expect(pagePath('about-us')).toBe('/about-us/');
    });

    it('looks slugs up the way Vendure stores them (NFD, lowercase)', () => {
        expect(lookupSlug(encodeURIComponent(MOTA.normalize('NFC')))).toBe(MOTA.normalize('NFD'));
        expect(lookupSlug('Silk-Saree')).toBe('silk-saree');
        expect(lookupSlug('%E0%A6')).toBe('%e0%a6');
    });

    it('serves the core’s asset URLs from the store’s own origin', () => {
        expect(sameOriginAssetUrl('http://localhost:3000/assets/preview/ab/x.jpg')).toBe(
            '/assets/preview/ab/x.jpg',
        );
        expect(sameOriginAssetUrl('https://cdn.example.com/other/x.jpg')).toBe(
            'https://cdn.example.com/other/x.jpg',
        );
        expect(sameOriginAssetUrl('/img/abc/160.webp')).toBe('/img/abc/160.webp');
    });
});

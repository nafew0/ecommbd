import { describe, expect, it } from 'vitest';
import {
    defaultMenus,
    encodeSlug,
    parseMenus,
    parsePageInput,
    policyLabel,
    POLICY_SLUGS,
    RESERVED_SLUGS,
    toSlug,
} from './content';

const empty = { title: '', slug: '', body: '', seoTitle: '', seoDescription: '' };

describe('toSlug', () => {
    it('makes slugs the way Vendure does, keeping Bangla', () => {
        expect(toSlug('  About Us! ')).toBe('about-us');
        expect(toSlug('Café & Crème_brûlée')).toBe('cafe-creme-brulee');
        expect(toSlug('আমাদের সম্পর্কে।')).toBe('আমাদের-সম্পর্কে'.normalize('NFD'));
        expect(toSlug('--a  --  b--')).toBe('a-b');
    });
});

describe('encodeSlug', () => {
    it('writes NFC, percent-encoded', () => {
        expect(encodeSlug('শাড়ি'.normalize('NFD'))).toBe(encodeURIComponent('শাড়ি'.normalize('NFC')));
        expect(encodeSlug('silk-saree')).toBe('silk-saree');
    });
});

describe('parsePageInput', () => {
    it('fills the slug from the title and cleans text', () => {
        const result = parsePageInput({
            enabled: true,
            translations: {
                bn: { ...empty, title: 'আমাদের কথা' },
                en: { ...empty, title: ' About   us ', slug: 'About Us' },
            },
        });
        expect(result).toMatchObject({
            ok: true,
            value: {
                translations: {
                    bn: { slug: 'আমাদের-কথা'.normalize('NFD') },
                    en: { title: 'About us', slug: 'about-us' },
                },
            },
        });
    });

    it('refuses reserved slugs, missing titles and long slugs', () => {
        const result = parsePageInput({
            enabled: true,
            translations: {
                bn: { ...empty, body: '<p>Text</p>' },
                en: { ...empty, title: 'Cart', slug: 'cart' },
            },
        });
        expect(result).toEqual({
            ok: false,
            errors: [
                { path: 'translations.bn.title', code: 'required' },
                { path: 'translations.en.slug', code: 'reserved' },
            ],
        });
        expect(parsePageInput({ enabled: false, translations: { bn: empty, en: empty } })).toEqual({
            ok: false,
            errors: [{ path: 'translations.bn.title', code: 'required' }],
        });
        const long = parsePageInput({
            enabled: true,
            translations: { bn: empty, en: { ...empty, title: 'x', slug: 'a'.repeat(130) } },
        });
        expect(long).toEqual({ ok: false, errors: [{ path: 'translations.en.slug', code: 'tooLong' }] });
    });

    it('keeps policy slugs reserved', () => {
        expect(RESERVED_SLUGS).toContain(POLICY_SLUGS.returnPolicy);
    });
});

describe('menus', () => {
    it('accepts links of every kind and two levels', () => {
        const result = parseMenus({
            header: [
                {
                    label: { bn: 'শাড়ি', en: '' },
                    link: { type: 'category', id: '3' },
                    children: [
                        {
                            label: { bn: '', en: 'Silk' },
                            link: { type: 'url', url: ' /product-category/silk/ ' },
                        },
                    ],
                },
                {
                    label: { bn: '', en: 'Blog' },
                    link: { type: 'url', url: 'https://blog.example.com/' },
                    children: [],
                },
                { label: { bn: '', en: 'About' }, link: { type: 'page', id: '1' }, children: [] },
                { label: { bn: '', en: 'Panjabi' }, link: { type: 'product', id: '9' }, children: [] },
            ],
            footer: defaultMenus().footer,
        });
        expect(result.ok).toBe(true);
        expect(result.ok && result.value.header[0]!.children[0]!.link).toEqual({
            type: 'url',
            url: '/product-category/silk/',
        });
    });

    it('refuses bad links and empty labels', () => {
        const item = (url: string) => ({
            label: { bn: 'x', en: '' },
            link: { type: 'url', url },
            children: [],
        });
        const result = parseMenus({
            header: [item('javascript:alert(1)'), item('//evil.example'), item(`/${'a'.repeat(600)}`)],
            footer: [{ label: { bn: '', en: '' }, link: { type: 'policy', policy: 'terms' }, children: [] }],
        });
        expect(result).toEqual({
            ok: false,
            errors: [
                { path: 'header.0.link.url', code: 'invalidUrl' },
                { path: 'header.1.link.url', code: 'invalidUrl' },
                { path: 'header.2.link.url', code: 'tooLong' },
                { path: 'footer.0.label', code: 'required' },
            ],
        });
    });

    it('starts with the policies in the footer', () => {
        expect(defaultMenus().footer.map(item => item.link)).toEqual([
            { type: 'policy', policy: 'returnPolicy' },
            { type: 'policy', policy: 'refundPolicy' },
            { type: 'policy', policy: 'privacyPolicy' },
            { type: 'policy', policy: 'terms' },
        ]);
        expect(policyLabel('terms', 'bn')).toBe('শর্তাবলি');
    });
});

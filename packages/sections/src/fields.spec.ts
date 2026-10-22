import { describe, expect, it } from 'vitest';
import {
    defaultValue,
    field,
    fieldShown,
    isAnchor,
    isLinkUrl,
    parseVideo,
    readValue,
    toAnchor,
    valueIssue,
} from './fields';
import { bilingual, cleanText, pick } from './text';

const label = { bn: 'লেবেল', en: 'Label' };

describe('text', () => {
    it('falls back to the other language', () => {
        expect(pick({ bn: '', en: 'Hello' }, 'bn')).toBe('Hello');
        expect(pick({ bn: 'হ্যালো', en: '' }, 'en')).toBe('হ্যালো');
        expect(pick({ bn: 'হ্যালো', en: 'Hello' }, 'en')).toBe('Hello');
        expect(bilingual('একই')).toEqual({ bn: 'একই', en: 'একই' });
    });

    it('cleans like the shared helper, keeping ZWJ and ZWNJ', () => {
        expect(cleanText('  a​ b\u0007  ')).toBe('a b');
        expect(cleanText('র‍্যাব')).toBe('র‍্যাব');
        expect(cleanText('one\r\n\n\n\ntwo  three', true)).toBe('one\n\ntwo three');
    });
});

describe('reading stored values', () => {
    it('reads text in both languages, cut to the limit', () => {
        const text = field.text(label, { bn: 'ডিফল্ট', en: 'Default' }, { max: 5 });
        expect(readValue(text, { bn: '  অনেক লম্বা লেখা ', en: 'Hello world' })).toEqual({
            bn: 'অনেক',
            en: 'Hello',
        });
        expect(readValue(text, 'plain')).toEqual({ bn: 'plain', en: 'plain' });
        expect(readValue(text, 42)).toEqual({ bn: 'ডিফল্ট', en: 'Default' });
        expect(readValue(text, { bn: 7 })).toEqual({ bn: '', en: '' });
    });

    it('keeps line breaks in long text and HTML in rich text', () => {
        const textarea = field.textarea(label);
        expect(readValue(textarea, { bn: 'এক\n\n\n\nদুই', en: '' })).toEqual({ bn: 'এক\n\nদুই', en: '' });
        const rich = field.richText(label);
        expect(readValue(rich, { bn: ' <p>a  b</p> ', en: '' })).toEqual({ bn: '<p>a  b</p>', en: '' });
    });

    it('reads images, products and lists of IDs', () => {
        const image = field.image(label);
        expect(readValue(image, { assetId: '12', preview: '/assets/a.jpg' })).toEqual({
            assetId: '12',
            preview: '/assets/a.jpg',
        });
        expect(readValue(image, { assetId: 12 })).toEqual({ assetId: '12', preview: '' });
        expect(readValue(image, { assetId: '../etc' })).toBeNull();
        expect(readValue(image, null)).toBeNull();
        expect(readValue(field.product(label), '7')).toBe('7');
        expect(readValue(field.collection(label), 0)).toBeNull();
        const list = field.productList(label, 2);
        expect(readValue(list, ['1', '1', 'bad id', 2, '3'])).toEqual(['1', '2']);
        expect(readValue(field.collectionList(label, 5), 'nope')).toEqual([]);
    });

    it('reads every kind of link', () => {
        const link = field.link(label, { type: 'search' });
        expect(readValue(link, { type: 'home' })).toEqual({ type: 'home' });
        expect(readValue(link, { type: 'whatsapp', href: 'https://evil.example' })).toEqual({
            type: 'whatsapp',
        });
        expect(readValue(link, { type: 'category', ref: '4' })).toEqual({ type: 'category', ref: '4' });
        expect(readValue(link, { type: 'product', ref: '' })).toEqual({ type: 'none' });
        expect(readValue(link, { type: 'policy', policy: 'terms' })).toEqual({
            type: 'policy',
            policy: 'terms',
        });
        expect(readValue(link, { type: 'policy', policy: 'other' })).toEqual({ type: 'none' });
        expect(readValue(link, { type: 'anchor', anchor: 'Order Form!' })).toEqual({
            type: 'anchor',
            anchor: 'order-form',
        });
        expect(readValue(link, { type: 'anchor' })).toEqual({ type: 'anchor', anchor: '' });
        expect(readValue(link, { type: 'url', url: ' https://example.com ' })).toEqual({
            type: 'url',
            url: 'https://example.com',
        });
        expect(readValue(link, { type: 'url' })).toEqual({ type: 'url', url: '' });
        expect(readValue(link, { type: 'javascript' })).toEqual({ type: 'search' });
        expect(readValue(link, 'x')).toEqual({ type: 'search' });
    });

    it('reads choices, switches and numbers', () => {
        expect(readValue(field.colour(label, 'accent'), 'sale')).toBe('sale');
        expect(readValue(field.colour(label, 'accent'), 'red; background: url(x)')).toBe('accent');
        const select = field.select(
            label,
            [
                { value: 'a', label },
                { value: 'b', label },
            ],
            'a',
        );
        expect(readValue(select, 'b')).toBe('b');
        expect(readValue(select, 'c')).toBe('a');
        expect(readValue(field.toggle(label, true), 'yes')).toBe(true);
        expect(readValue(field.toggle(label), true)).toBe(true);
        const range = field.range(label, { min: 2, max: 10, step: 2 }, 4);
        expect(readValue(range, 7)).toBe(8);
        expect(readValue(range, '3')).toBe(4);
        expect(readValue(range, 99)).toBe(10);
        expect(readValue(range, -5)).toBe(2);
        expect(readValue(range, 'many')).toBe(4);
        expect(readValue(range, '')).toBe(4);
        expect(readValue(field.video(label), ' https://youtu.be/dQw4w9WgXcQ ')).toBe(
            'https://youtu.be/dQw4w9WgXcQ',
        );
        expect(readValue(field.video(label), 5)).toBe('');
    });

    it('gives fresh copies of defaults', () => {
        const text = field.text(label, { bn: 'ক', en: 'A' });
        const first = defaultValue(text);
        first.bn = 'changed';
        expect(defaultValue(text)).toEqual({ bn: 'ক', en: 'A' });
        expect(defaultValue(field.link(label))).toEqual({ type: 'none' });
        expect(defaultValue(field.image(label))).toBeNull();
    });
});

describe('publishing checks', () => {
    it('accepts store paths and web addresses only', () => {
        expect(isLinkUrl('/product-category/saree/')).toBe(true);
        expect(isLinkUrl('https://example.com/a?b=1')).toBe(true);
        expect(isLinkUrl('//evil.example')).toBe(false);
        expect(isLinkUrl('javascript:alert(1)')).toBe(false);
        expect(isLinkUrl('https://localhost')).toBe(false);
        expect(isLinkUrl('example.com')).toBe(false);
    });

    it('makes anchors from typed text', () => {
        expect(toAnchor('  Order   Form ')).toBe('order-form');
        expect(toAnchor('অর্ডার')).toBe('');
        expect(isAnchor('order-form')).toBe(true);
        expect(isAnchor('-x')).toBe(false);
    });

    it('reports broken links, anchors and videos', () => {
        const link = field.link(label);
        expect(valueIssue(link, { type: 'url', url: 'not a url' })).toBe('invalidUrl');
        expect(valueIssue(link, { type: 'url', url: '/ok/' })).toBeNull();
        expect(valueIssue(link, { type: 'anchor', anchor: '' })).toBe('invalidAnchor');
        expect(valueIssue(link, { type: 'none' })).toBeNull();
        const video = field.video(label);
        expect(valueIssue(video, '')).toBeNull();
        expect(valueIssue(video, 'https://vimeo.com/1')).toBe('invalidVideo');
        expect(valueIssue(video, 'https://youtu.be/dQw4w9WgXcQ')).toBeNull();
        expect(valueIssue(field.toggle(label), true)).toBeNull();
    });

    it('shows conditional fields only when their condition holds', () => {
        const collection = field.collection(label, { when: { source: ['collection'] } });
        expect(fieldShown(collection, { source: 'collection' })).toBe(true);
        expect(fieldShown(collection, { source: 'newest' })).toBe(false);
        expect(fieldShown(field.toggle(label), {})).toBe(true);
    });
});

describe('videos', () => {
    it('understands the usual YouTube addresses', () => {
        for (const url of [
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
            'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ',
            'https://www.youtube.com/shorts/dQw4w9WgXcQ',
            'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        ]) {
            expect(parseVideo(url)).toMatchObject({
                provider: 'youtube',
                id: 'dQw4w9WgXcQ',
                embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
                thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            });
        }
        expect(parseVideo('https://www.youtube.com/watch?v=short')).toBeNull();
        expect(parseVideo('https://www.youtube.com/channel/abc')).toBeNull();
    });

    it('understands Facebook videos and reels', () => {
        expect(parseVideo('https://www.facebook.com/shop/videos/123456/')).toMatchObject({
            provider: 'facebook',
            watchUrl: 'https://www.facebook.com/shop/videos/123456/',
        });
        expect(parseVideo('https://facebook.com/watch/?v=987')?.watchUrl).toBe(
            'https://www.facebook.com/watch/?v=987',
        );
        expect(parseVideo('https://www.facebook.com/reel/555')?.embedUrl).toContain(
            encodeURIComponent('https://www.facebook.com/reel/555'),
        );
        expect(parseVideo('https://www.facebook.com/watch/?v=abc')).toBeNull();
        expect(parseVideo('https://www.facebook.com/shop')).toBeNull();
    });

    it('refuses anything else', () => {
        expect(parseVideo('not a url')).toBeNull();
        expect(parseVideo('ftp://youtu.be/dQw4w9WgXcQ')).toBeNull();
        expect(parseVideo('https://example.com/video.mp4')).toBeNull();
    });
});

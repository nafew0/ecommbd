import { describe, expect, it } from 'vitest';
import {
    looksLikeHtml,
    richTextToHtml,
    richTextToPlain,
    sanitizeRichText,
    stripShortcodes,
    textToHtml,
} from './rich-text';

describe('sanitizeRichText', () => {
    it('keeps formatting and removes scripts, handlers, styles and frames', () => {
        const html = sanitizeRichText(
            '<h1>Panjabi</h1><p onclick="steal()" style="color:red">Pure <strong>cotton</strong>, <em>soft</em>.</p>' +
                '<script>alert(1)</script><style>p{}</style><iframe src="https://evil.example"></iframe>' +
                '<ul><li>Size M</li></ul><table><tr><td colspan="2">Chest</td></tr></table>',
        );
        expect(html).toBe(
            '<h2>Panjabi</h2><p>Pure <strong>cotton</strong>, <em>soft</em>.</p>' +
                '<ul><li>Size M</li></ul><table><tr><td colspan="2">Chest</td></tr></table>',
        );
    });

    it('allows safe links only, marked nofollow', () => {
        expect(sanitizeRichText('<a href="https://example.com" target="_blank">Shop</a>')).toBe(
            '<a href="https://example.com" rel="noopener nofollow">Shop</a>',
        );
        expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe(
            '<a rel="noopener nofollow">x</a>',
        );
        expect(sanitizeRichText('<a href="tel:+8801712345678">Call</a>')).toContain(
            'href="tel:+8801712345678"',
        );
    });

    it('keeps our own images and drops images from elsewhere', () => {
        expect(sanitizeRichText('<img src="/img/abc/480.webp" alt="Shirt" onerror="x()">')).toBe(
            '<img src="/img/abc/480.webp" alt="Shirt" />',
        );
        expect(sanitizeRichText('<img src="https://tracker.example/p.gif">')).toBe('<img />');
        expect(sanitizeRichText('<img src="//tracker.example/p.gif">')).toBe('<img />');
    });

    it('removes WooCommerce shortcodes but keeps their text', () => {
        expect(sanitizeRichText('[vc_row][vc_column]<p>নরম সুতি</p>[/vc_column][/vc_row]')).toBe(
            '<p>নরম সুতি</p>',
        );
    });
});

describe('stripShortcodes', () => {
    it('reports what it removed and leaves ordinary brackets', () => {
        expect(
            stripShortcodes('[caption id="1"]Photo[/caption] [Free delivery] [১] [et_pb_section]x'),
        ).toEqual({
            text: 'Photo [Free delivery] [১] x',
            removed: ['caption', 'et_pb_section'],
        });
        expect(stripShortcodes('[gallery ids="1,2" /]').text).toBe('');
        expect(stripShortcodes('[note]keep[/note]').removed).toEqual([]);
    });
});

describe('plain text and HTML', () => {
    it('tells HTML from plain text', () => {
        expect(looksLikeHtml('<p>Hi</p>')).toBe(true);
        expect(looksLikeHtml('Line one<br/>')).toBe(true);
        expect(looksLikeHtml('Price < 500 and > 100')).toBe(false);
        expect(looksLikeHtml('সাইজ: M, L, XL')).toBe(false);
    });

    it('turns plain text into paragraphs, escaped', () => {
        expect(textToHtml('Soft cotton.\r\nMachine wash.\n\n<b>Not bold</b> & "quoted" \'x\'')).toBe(
            '<p>Soft cotton.<br>Machine wash.</p>\n<p>&lt;b&gt;Not bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;x&#39;</p>',
        );
        expect(textToHtml('\n\n  \n')).toBe('');
    });

    it('renders either kind', () => {
        expect(richTextToHtml('<p>Hi<script>x</script></p>')).toBe('<p>Hi</p>');
        expect(richTextToHtml('Hi [vc_row]there')).toBe('<p>Hi there</p>');
    });

    it('gives plain text for meta descriptions, cut at a word', () => {
        expect(
            richTextToPlain(
                '<p>Soft&nbsp;cotton &amp; silk &lt;3 &quot;new&quot; it&#39;s &gt;</p>\n<p>Two</p>',
            ),
        ).toBe('Soft cotton & silk <3 "new" it\'s > Two');
        expect(richTextToPlain('<p>Eid.</p><ul><li>Wash</li><li>Dry</li></ul>Line<br>break')).toBe(
            'Eid. Wash Dry Line break',
        );
        expect(richTextToPlain('one two three four five six', 15)).toBe('one two three…');
        expect(richTextToPlain('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…');
    });
});

import sanitizeHtml from 'sanitize-html';

/**
 * Rich text for product descriptions and pages (roadmap phase 12). Sanitized on save and again on
 * render: an admin account can be compromised, and imported WooCommerce HTML can contain anything.
 * Server-side only (Node): the storefront renders on the server and ships no sanitizer.
 */

const ALLOWED_TAGS = [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
];

const OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
        a: ['href', 'title', 'rel'],
        img: ['src', 'alt', 'width', 'height'],
        th: ['colspan', 'rowspan'],
        td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Images only from our own site (`/img/…`, `/assets/…`): no tracking pixels from elsewhere.
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    transformTags: {
        // h1 is the page's own title: lower it rather than drop the text.
        h1: 'h2',
        a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener nofollow' } }),
    },
    // Script and style contents are dropped with their tags, not left as text.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'template'],
};

/** Page builders and plugins whose shortcodes WooCommerce stores leave behind. */
const SHORTCODE_PREFIXES = [
    'vc_',
    'et_pb_',
    'fusion_',
    'woocommerce_',
    'elementor',
    'av_',
    'tm_',
    'mk_',
    'ux_',
];
const SHORTCODE_NAMES = new Set([
    'caption',
    'gallery',
    'embed',
    'video',
    'audio',
    'playlist',
    'product',
    'products',
    'product_page',
    'add_to_cart',
    'contact-form-7',
    'button',
    'row',
    'column',
    'col',
    'section',
    'tabs',
    'tab',
    'accordion',
    'toggle',
]);

function isShortcode(name: string): boolean {
    return SHORTCODE_NAMES.has(name) || SHORTCODE_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Removes WordPress shortcodes (`[vc_row]`, `[/vc_column]`, `[caption id="1"]`), keeping the text
 * between them. Square brackets in ordinary text (`[Free delivery]`, `[১]`) are left alone.
 * Returns the names removed, for the migration report (phase 21).
 */
export function stripShortcodes(input: string): { text: string; removed: string[] } {
    const removed = new Set<string>();
    const text = input.replace(/\[\/?([a-z][a-z0-9_-]*)(?:\s[^\]]*)?\/?\]/g, (match, name: string) => {
        if (!isShortcode(name)) return match;
        removed.add(name);
        return '';
    });
    return { text, removed: [...removed] };
}

/** True when the text contains HTML tags (otherwise it's plain text with line breaks). */
export function looksLikeHtml(input: string): boolean {
    return /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(input);
}

/** Keeps only safe formatting: no scripts, styles, event handlers, frames or outside images. */
export function sanitizeRichText(html: string): string {
    return sanitizeHtml(stripShortcodes(html).text, OPTIONS).trim();
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Plain text to HTML: blank lines separate paragraphs, single line breaks stay. */
export function textToHtml(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean)
        .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

/** HTML ready to render from a description or page body, whether it was typed as text or HTML. */
export function richTextToHtml(input: string): string {
    return looksLikeHtml(input) ? sanitizeRichText(input) : textToHtml(stripShortcodes(input).text);
}

/** Plain text of rich text, on one line and cut at a word near `maxLength` (meta descriptions). */
export function richTextToPlain(input: string, maxLength = 160): string {
    // Blocks and line breaks become spaces, so "<p>One</p><p>Two</p>" reads "One Two".
    const spaced = stripShortcodes(input).text.replace(
        /<\/(p|li|h[1-6]|div|tr|td|th|blockquote)>|<br\s*\/?>/gi,
        ' ',
    );
    const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength) return text;
    const cut = text.slice(0, maxLength - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > maxLength / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

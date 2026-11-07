/**
 * What Varnish may keep, and under which tags (roadmap phase 17). The middleware runs every
 * response through {@link tagResponse}; pages add their own tags with an `xkey` header in their
 * frontmatter. The core purges by the same names: apps/core/src/plugins/cache-purge/tags.ts lists
 * them, and the two must stay in step.
 *
 * The rules for which requests are private are the same as the VCL's (infra/varnish/default.vcl),
 * so a page can't be cached by one and treated as personal by the other.
 */

/** Every cacheable page: what the layout around it shows (header, footer, theme, store settings). */
const SITE_TAGS = ['store', 'settings', 'theme', 'menus'];

/**
 * A page that names no tags of its own (sitemaps, robots.txt, the theme stylesheet, Astro's 404)
 * gets these, so any catalog or content change refreshes it. Every entity purge includes
 * `listing`, so this also stands in for entity tags that didn't fit the header.
 */
const BROAD_TAGS = ['listing', 'products', 'pages', 'layouts', 'sales-pages', 'collections'];

/** Header budget: Varnish's default limit for one response header line is 8 KB. */
const MAX_TAGS = 100;
const MAX_HEADER = 6000;

/** Letters, digits and `:_-`, as the VCL and the core accept. */
const TAG = /^[a-zA-Z0-9:_-]{1,80}$/;

/** The kind of page, for the `type:<kind>` tag and the speed beacon's report. */
export function routeKind(path: string): string {
    const clean = path.replace(/^\/(?:en|bn)(?=\/)/, '');
    if (clean === '/') return 'home';
    if (clean.startsWith('/product/')) return 'product';
    if (clean.startsWith('/product-category/')) return 'category';
    if (clean.startsWith('/s/')) return 'sales';
    if (clean.startsWith('/search')) return 'search';
    if (clean.startsWith('/checkout')) return 'checkout';
    if (clean.startsWith('/cart')) return 'cart';
    return 'page';
}

/**
 * True for a request whose answer is personal or must not be shared: anything but GET/HEAD,
 * signed-in staff or API clients, personal routes (by path prefix, never by file extension:
 * `/account/x.css` is still private), a sales page's order and thank-you pages, addresses carrying
 * a preview, token or personal data, and a session cookie. An address that can't be decoded is
 * private too.
 */
export function privateRequest(request: Request): boolean {
    const url = new URL(request.url);
    let path: string;
    try {
        path = decodeURIComponent(url.pathname)
            .toLowerCase()
            .replace(/^\/(?:en|bn)(?=\/)/, '');
    } catch {
        return true;
    }
    const personalRoute =
        /^\/(?:admin|dashboard|admin-api|shop-api|woo-migrate|cache-metrics|cart|checkout|account|track|t|health)(?:\/|[?.]|$)/;
    const personalQuery = /^(preview|token|auth|session|code|password|email|phone)$/i;
    const sessionCookie = /(?:^|;\s*)[^=;]*(?:session|admin|auth|csrf)[^=;]*=/i;
    return (
        !['GET', 'HEAD'].includes(request.method) ||
        request.headers.has('authorization') ||
        personalRoute.test(path) ||
        /^\/s\/[^/]+\/(?:order|thank-you)(?:\/|[?.]|$)/.test(path) ||
        [...url.searchParams.keys()].some(key => personalQuery.test(key)) ||
        sessionCookie.test(request.headers.get('cookie') ?? '')
    );
}

/** The page's own tags, as it set them in `xkey`, without anything malformed. */
function ownTags(response: Response): string[] | null {
    const header = response.headers.get('xkey');
    if (header === null) return null;
    return header.split(/\s+/).filter(tag => TAG.test(tag));
}

/**
 * The tags for one cacheable page: the site-wide ones, its kind, the page's own, `products` when
 * it shows any product, and `layoutTags` from the middleware (what the header shows). If they
 * don't fit the header, the page's entity tags give way to {@link BROAD_TAGS}.
 */
export function pageTags(kind: string, own: string[] | null, layoutTags: string[] = []): string[] {
    const page = own ?? BROAD_TAGS;
    const shows = page.some(tag => tag.startsWith('product:')) ? ['products'] : [];
    return [...new Set([...SITE_TAGS, `type:${kind}`, ...layoutTags, ...shows, ...page])];
}

/** Each tag with the store's prefix, within the header budget (or the broad fallback). */
function scopedHeader(tags: string[], storeId: string): string {
    const header = (list: string[]) => list.map(tag => `${storeId}:${tag}`).join(' ');
    const full = header(tags);
    if (tags.length <= MAX_TAGS && full.length <= MAX_HEADER) return full;
    // Too many entity tags (a page showing hundreds of products): keep the named, non-entity tags
    // and add the broad ones. Every entity purge also purges `listing`, so nothing is missed.
    const kept = tags.filter(tag => !/^(?:product|collection|page|sales-page|layout):/.test(tag));
    return header([...new Set([...kept, ...BROAD_TAGS])]);
}

/**
 * Marks a response for Varnish. A private request, a preview, a response the page marked
 * `no-store`/`private`, or an error gets `no-store` and no tags. Anything else is tagged (see
 * {@link pageTags}) and, unless the page chose its own cache policy, kept by Varnish for 7 days
 * (60 seconds for a 404) and revalidated by browsers on every visit, so a purge shows on reload.
 *
 * `layoutTags` comes from the middleware: `collections` when the header lists the top categories.
 */
export function tagResponse(
    response: Response,
    request: Request,
    storeId: string,
    preview = false,
    layoutTags: string[] = [],
) {
    if (
        preview ||
        privateRequest(request) ||
        response.headers.get('cache-control')?.match(/no-store|private/i) ||
        response.status >= 500
    ) {
        response.headers.set('cache-control', 'no-store');
        response.headers.delete('xkey');
        response.headers.delete('x-cache-store');
        return response;
    }
    const kind = routeKind(new URL(request.url).pathname);
    response.headers.set('xkey', scopedHeader(pageTags(kind, ownTags(response), layoutTags), storeId));
    // Varnish stores only responses carrying this header: a page served without our middleware
    // (or with it misconfigured) is never cached.
    response.headers.set('x-cache-store', storeId);
    if (!response.headers.has('cache-control') || response.status === 404)
        response.headers.set(
            'cache-control',
            `public, max-age=0, s-maxage=${response.status === 404 ? 60 : 604800}, must-revalidate`,
        );
    return response;
}

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
    return (
        !['GET', 'HEAD'].includes(request.method) ||
        request.headers.has('authorization') ||
        /^\/(?:admin|dashboard|admin-api|shop-api|woo-migrate|cache-metrics|cart|checkout|account|track|t|health)(?:\/|[?.]|$)/.test(
            path,
        ) ||
        /^\/s\/[^/]+\/(?:order|thank-you)(?:\/|[?.]|$)/.test(path) ||
        [...url.searchParams.keys()].some(k =>
            /^(preview|token|auth|session|code|password|email|phone)$/i.test(k),
        ) ||
        /(?:^|;\s*)[^=;]*(?:session|admin|auth|csrf)[^=;]*=/i.test(request.headers.get('cookie') ?? '')
    );
}
export function tagResponse(response: Response, request: Request, storeId: string, preview = false) {
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
    const dependencies = (response.headers.get('xkey') ?? '')
        .split(/\s+/)
        .filter(t => /^[a-zA-Z0-9:_-]{1,80}$/.test(t));
    const broad = [
        'store',
        'settings',
        'theme',
        'menus',
        'layouts',
        'pages',
        'sales-pages',
        'collections',
        'catalog',
        `type:${kind}`,
    ];
    // Broad fallback dependencies remain even when entity tags exceed the header budget.
    const tags: string[] = [];
    for (const tag of [...new Set([...broad, ...dependencies])].slice(0, 100)) {
        const scoped = `${storeId}:${tag}`;
        if ([...tags, scoped].join(' ').length > 6000) break;
        tags.push(scoped);
    }
    response.headers.set('xkey', tags.join(' '));
    response.headers.set('x-cache-store', storeId);
    if (!response.headers.has('cache-control') || response.status === 404)
        response.headers.set(
            'cache-control',
            `public, max-age=0, s-maxage=${response.status === 404 ? 60 : 604800}, must-revalidate`,
        );
    return response;
}

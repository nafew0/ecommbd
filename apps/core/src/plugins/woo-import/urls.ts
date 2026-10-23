import { localPath } from './helpers';

/**
 * Normalize an old store path once, the way the storefront spells paths: each segment decoded,
 * composed (NFC) and lowercased, then encoded again; a trailing slash on pages (not on files such
 * as `image.jpg`); and only WordPress's own query selectors kept (`?p=`, `?product=`,
 * `?attachment_id=`). Encoded separators, control characters and protocol-relative URLs refuse.
 */
export function migrationPath(value: string): string {
    const url = new URL(localPath(value), 'https://migration.invalid');
    const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map(part => {
            const decoded = decodeURIComponent(part).normalize('NFC').toLowerCase();
            if (/[/\\?#]/.test(decoded) || Array.from(decoded).some(c => c.charCodeAt(0) <= 32))
                throw new Error('INVALID_LOCAL_PATH');
            return encodeURIComponent(decoded);
        });
    const path = segments.length
        ? '/' + segments.join('/') + (/\.[a-z0-9]{2,5}$/i.test(segments[segments.length - 1]) ? '' : '/')
        : '/';
    const query = new URLSearchParams();
    for (const key of ['p', 'product', 'attachment_id'])
        if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key)!);
    const result = path + (query.size ? '?' + query.toString() : '');
    if (result.length > 1000) throw new Error('INVALID_LOCAL_PATH');
    return result;
}

/**
 * Our own addresses, the one list every redirect rule is checked against (normalized paths).
 * - `RESERVED_TARGET`: a redirect may never send shoppers to the admin, the APIs, the importer's
 *   upload endpoint, or into the checkout or tracking flows.
 * - `RESERVED_SOURCE`: an imported or saved rule may never claim one of the store's own working
 *   addresses either, so even a hostile Redirection-plugin export can't capture the home page,
 *   the sitemap or robots.txt. (The storefront also asks for a rule only when it has no page of
 *   its own, so a store page always wins; this list is the second line of defence.)
 * - `MISS_EXCLUDED`: paths not worth listing as "missing pages": ours, and the probes bots send
 *   to every WordPress site (logins, XML-RPC, PHP files, dotfiles).
 */
const TARGETS = 'admin|admin-api|shop-api|woo-migrate|dashboard|checkout|cart|t|track';
export const RESERVED_TARGET = new RegExp(`^/(?:${TARGETS})(?:/|\\?|$)`);
// Normalized paths keep only `?p=`, `?product=` and `?attachment_id=`, so `/` alone is the home
// page, and `/?p=123` (an old WordPress post link) stays allowed.
export const RESERVED_SOURCE = new RegExp(
    `^/(?:$|(?:${TARGETS}|account|search|s|health|assets|img|bd-geo|_astro)(?:/|\\?|$)|(?:sitemap[^/]*\\.xml|robots\\.txt|theme\\.css)$)`,
);
export const MISS_EXCLUDED = new RegExp(
    `${RESERVED_SOURCE.source}|^/(?:wp-login\\.php|xmlrpc\\.php|wp-admin|wp-includes|wp-json|cgi-bin|phpmyadmin)(?:/|\\?|$)|\\.php(?:\\?|$)|/\\.`,
);

/** A redirect's target, normalized, refusing our own private addresses. */
export function safeMigrationTarget(path: string) {
    const normalized = migrationPath(path);
    if (RESERVED_TARGET.test(normalized)) throw new Error('RESERVED_REDIRECT_PATH');
    return normalized;
}

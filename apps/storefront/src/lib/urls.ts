import { encodeSlug } from '@ecommbd/shared/content';
import { isLang, type Lang } from './i18n';

/**
 * Storefront URLs (roadmap phase 12): WooCommerce-style, always with a trailing slash; the default
 * language without a prefix, the other under `/en/` or `/bn/`.
 */

/** Paths that name a file (`/sitemap.xml`, `/robots.txt`) never get a trailing slash. */
function isFilePath(path: string): boolean {
    return /\.[a-z0-9]{2,5}$/i.test(path);
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        // Broken percent-encoding: keep it as it came.
        return segment;
    }
}

/**
 * The one canonical spelling of a path: each segment decoded, composed (NFC), lowercased and
 * re-encoded; empty segments removed; a trailing slash unless it names a file.
 */
export function normalizePath(path: string): string {
    const segments = path
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(decodeSegment(segment).normalize('NFC').toLowerCase()));
    if (!segments.length) return '/';
    const joined = `/${segments.join('/')}`;
    return isFilePath(joined) ? joined : `${joined}/`;
}

export interface LocalePath {
    /** The language from the prefix, or the store's default language. */
    lang: Lang;
    /** The path without the language prefix, normalized. */
    path: string;
}

/** Splits `/en/product/x/` into the language and `/product/x/`. */
export function parseLocalePath(pathname: string, defaultLang: Lang): LocalePath {
    const [first, ...rest] = pathname.split('/').filter(Boolean);
    const prefix = first?.toLowerCase();
    if (isLang(prefix)) return { lang: prefix, path: normalizePath(rest.join('/')) };
    return { lang: defaultLang, path: normalizePath(pathname) };
}

/** A path in a language: the default language has no prefix. */
export function localePath(lang: Lang, defaultLang: Lang, path: string): string {
    return lang === defaultLang ? path : `/${lang}${path === '/' ? '/' : path}`;
}

export const productPath = (slug: string) => `/product/${encodeSlug(slug)}/`;

export const categoryPath = (slugs: string[]) => `/product-category/${slugs.map(encodeSlug).join('/')}/`;

export const pagePath = (slug: string) => `/${encodeSlug(slug)}/`;

/** A slug from a URL as Vendure stores it: decoded, decomposed (NFD), lowercase. */
export function lookupSlug(segment: string): string {
    return decodeSegment(segment).normalize('NFD').toLowerCase();
}

/** Asset URLs from the core point at the core's own origin in development; make them same-origin. */
export function sameOriginAssetUrl(url: string): string {
    if (!/^https?:\/\//.test(url)) return url;
    const parsed = new URL(url);
    return parsed.pathname.startsWith('/assets/') ? `${parsed.pathname}${parsed.search}` : url;
}

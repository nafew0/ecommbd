import { defineMiddleware } from 'astro:middleware';
import { env } from './env';
import { CoreUnavailableError, RateLimitedError } from './lib/core';
import { parseLocalePath } from './lib/urls';
import { getTheme } from './lib/sections';
import { getSettings } from './lib/store';
import { systemPage } from './lib/system-pages';

/**
 * Every request (roadmap phase 12):
 * - a suspended or maintenance store gets the 503 page;
 * - the language comes from the `/en/` or `/bn/` prefix (the store's default has none);
 * - the path is normalized (trailing slash, case, Unicode, percent-encoding) and the page renders
 *   at that path; each page then 301s once to its canonical URL if the request spelled it otherwise;
 * - security headers on every response.
 */

/** Video sections (phase 15) play YouTube and Facebook in a frame once the shopper presses play. */
const VIDEO_FRAMES = 'https://www.youtube-nocookie.com https://www.facebook.com';

interface HeaderOptions {
    editorFrame?: boolean;
    /** Previews redraw their sections, and their generated styles, without a reload. */
    preview?: boolean;
    styleHashes?: string[];
}

function styleSource(options: HeaderOptions): string {
    // `astro dev` adds the CSS as inline <style> tags (for live reload); the build serves files.
    if (import.meta.env.DEV || options.preview) return "style-src 'self' 'unsafe-inline'";
    // The page's own generated stylesheet (Design options, phase 16), allowed by its hash only.
    const hashes = (options.styleHashes ?? []).map(hash => `'sha256-${hash}'`);
    return ["style-src 'self'", ...hashes].join(' ');
}

function securityHeaders(options: HeaderOptions = {}): Record<string, string> {
    const extra = env().CSP_ALLOWED_ORIGINS.join(' ');
    const editor = options.editorFrame ? env().EDITOR_ORIGIN : undefined;
    const csp = [
        "default-src 'self'",
        `script-src 'self' ${extra}`.trim(),
        styleSource(options),
        // YouTube's own thumbnails for video sections.
        `img-src 'self' data: https://i.ytimg.com ${extra}`.trim(),
        "font-src 'self'",
        `connect-src 'self' ${extra}`.trim(),
        `frame-src ${VIDEO_FRAMES}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // The page editor (phase 15) previews the store in a frame on the same site; in development
        // the admin runs elsewhere (EDITOR_ORIGIN), allowed only on preview pages.
        `frame-ancestors 'self'${editor ? ` ${editor}` : ''}`,
    ].join('; ');
    return {
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        // Superseded by frame-ancestors where browsers support it; kept for old ones, except on
        // preview pages, which another origin's editor may frame.
        ...(editor ? {} : { 'x-frame-options': 'SAMEORIGIN' }),
    };
}

function withHeaders(response: Response, options: HeaderOptions = {}): Response {
    for (const [name, value] of Object.entries(securityHeaders(options))) response.headers.set(name, value);
    if (!response.headers.has('cache-control')) {
        // Catalogue pages: cacheable for a minute (Varnish takes over in phase 17).
        response.headers.set('cache-control', 'public, max-age=60');
    }
    return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
    const state = env().STOREFRONT_STATE;
    if (state !== 'live') return withHeaders(systemPage(state));
    if (context.url.pathname.startsWith('/_astro/')) return next();

    try {
        const [settings, theme] = await Promise.all([getSettings(), getTheme()]);
        const defaultLang = settings.locale.defaultLanguage === 'en' ? 'en' : 'bn';
        // The path as sent: Astro's `context.url` has its percent-encoding already redone.
        const requestPath = new URL(context.request.url).pathname;
        const { lang, path } = parseLocalePath(requestPath, defaultLang);
        context.locals.lang = lang;
        context.locals.defaultLang = defaultLang;
        context.locals.settings = settings;
        context.locals.theme = theme;
        context.locals.requestPath = requestPath;
        const response =
            path === context.url.pathname ? await next() : await next(`${path}${context.url.search}`);
        return withHeaders(response, {
            editorFrame: context.locals.preview?.mode === 'editor',
            preview: !!context.locals.preview,
            styleHashes: context.locals.styleHashes,
        });
    } catch (error) {
        if (error instanceof CoreUnavailableError) return withHeaders(systemPage('unavailable'));
        if (error instanceof RateLimitedError) return withHeaders(systemPage('busy'));
        console.error(JSON.stringify({ level: 'error', msg: 'render failed', error: String(error) }));
        return withHeaders(systemPage('error'));
    }
});

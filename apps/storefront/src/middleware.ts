import { defineMiddleware } from 'astro:middleware';
import { env } from './env';
import { CoreUnavailableError, RateLimitedError } from './lib/core';
import { parseLocalePath } from './lib/urls';
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

function securityHeaders(): Record<string, string> {
    const extra = env().CSP_ALLOWED_ORIGINS.join(' ');
    const csp = [
        "default-src 'self'",
        `script-src 'self' ${extra}`.trim(),
        // `astro dev` adds the CSS as inline <style> tags (for live reload); the build serves files.
        import.meta.env.DEV ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        `img-src 'self' data: ${extra}`.trim(),
        "font-src 'self'",
        `connect-src 'self' ${extra}`.trim(),
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // The page editor (phase 15) previews the store in a frame on the same site.
        "frame-ancestors 'self'",
    ].join('; ');
    return {
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'x-frame-options': 'SAMEORIGIN',
    };
}

function withHeaders(response: Response): Response {
    for (const [name, value] of Object.entries(securityHeaders())) response.headers.set(name, value);
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
        const settings = await getSettings();
        const defaultLang = settings.locale.defaultLanguage === 'en' ? 'en' : 'bn';
        // The path as sent: Astro's `context.url` has its percent-encoding already redone.
        const requestPath = new URL(context.request.url).pathname;
        const { lang, path } = parseLocalePath(requestPath, defaultLang);
        context.locals.lang = lang;
        context.locals.defaultLang = defaultLang;
        context.locals.settings = settings;
        context.locals.requestPath = requestPath;
        const response =
            path === context.url.pathname ? await next() : await next(`${path}${context.url.search}`);
        return withHeaders(response);
    } catch (error) {
        if (error instanceof CoreUnavailableError) return withHeaders(systemPage('unavailable'));
        if (error instanceof RateLimitedError) return withHeaders(systemPage('busy'));
        console.error(JSON.stringify({ level: 'error', msg: 'render failed', error: String(error) }));
        return withHeaders(systemPage('error'));
    }
});

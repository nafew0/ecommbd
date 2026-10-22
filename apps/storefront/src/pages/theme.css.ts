import { themeCss, themeVersion } from '@ecommbd/sections';
import type { APIRoute } from 'astro';

/**
 * The theme's colours (phase 15) as a stylesheet, linked only when the merchant changed the theme's
 * own colours. Inline styles would need 'unsafe-inline' in the Content Security Policy. The link
 * carries the settings' version, so the current one is cached for good and a change is a new URL.
 */
export const GET: APIRoute = ({ locals, url }) => {
    const current = url.searchParams.get('v') === themeVersion(locals.theme);
    return new Response(themeCss(locals.theme), {
        headers: {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': current ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        },
    });
};

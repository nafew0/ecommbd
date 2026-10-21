import type { APIRoute } from 'astro';
import { env } from '../env';

/** Cart, checkout, account, search and filtered lists stay out of search engines (both languages). */
const PRIVATE = ['/cart/', '/checkout/', '/account/', '/search/', '/track/', '/t/'];

export const GET: APIRoute = () => {
    const lines = ['User-agent: *'];
    for (const prefix of ['', '/en', '/bn']) {
        for (const path of PRIVATE) lines.push(`Disallow: ${prefix}${path}`);
    }
    // Filters arrive in phase 13 as query parameters.
    lines.push('Disallow: /*?*filter=', '', `Sitemap: ${env().SITE_URL}/sitemap.xml`, '');
    return new Response(lines.join('\n'), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
};

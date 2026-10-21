import type { APIRoute } from 'astro';
import { env } from '../env';
import { sitemapIndex, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = () =>
    xmlResponse(
        sitemapIndex(['sitemap-products.xml', 'sitemap-categories.xml', 'sitemap-pages.xml'], env().SITE_URL),
    );

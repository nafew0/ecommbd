import type { APIRoute } from 'astro';
import { sitemap } from '../lib/sitemap';

/** Brand pages (phase 55). */
export const GET: APIRoute = () => sitemap('brands');

import type { APIRoute } from 'astro';
import { sitemap } from '../lib/sitemap';

export const GET: APIRoute = () => sitemap('categories');

import { POLICY_SLUGS } from '@ecommbd/shared/content';
import type { PolicyKey } from '@ecommbd/shared/store-settings';
import { env } from '../env';
import { shopQuery } from './core';
import { LANGS, type Lang } from './i18n';
import { SITEMAP_COLLECTIONS, SITEMAP_PAGES, SITEMAP_PRODUCTS } from './queries';
import { getSettings } from './store';
import { categoryPath, localePath, pagePath, productPath } from './urls';

/** Sitemaps (roadmap phase 12): an index, then products, categories and pages, each URL in both languages. */

export interface SitemapEntry {
    /** Unprefixed path in each language. */
    paths: Record<Lang, string>;
    lastmod?: string;
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function xmlResponse(xml: string): Response {
    return new Response(xml, {
        headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=3600',
        },
    });
}

export function sitemapIndex(names: string[], site: string): string {
    const items = names.map(name => `<sitemap><loc>${escapeXml(`${site}/${name}`)}</loc></sitemap>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`;
}

/** One `<url>` per language, each listing both languages as `xhtml:link` alternates. */
export function urlSet(entries: SitemapEntry[], site: string, defaultLang: Lang): string {
    const url = (lang: Lang, entry: SitemapEntry) =>
        `${site}${localePath(lang, defaultLang, entry.paths[lang])}`;
    const items = entries
        .flatMap(entry =>
            LANGS.map(lang => {
                const links = LANGS.map(
                    other =>
                        `<xhtml:link rel="alternate" hreflang="${other}" href="${escapeXml(url(other, entry))}"/>`,
                ).join('');
                const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod.slice(0, 10)}</lastmod>` : '';
                return `<url><loc>${escapeXml(url(lang, entry))}</loc>${lastmod}${links}</url>`;
            }),
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${items}</urlset>`;
}

async function defaultLang(): Promise<Lang> {
    return (await getSettings()).locale.defaultLanguage === 'en' ? 'en' : 'bn';
}

export async function productEntries(): Promise<SitemapEntry[]> {
    const entries: SitemapEntry[] = [];
    for (let skip = 0; ; skip += 100) {
        const { products } = await shopQuery(SITEMAP_PRODUCTS, { skip }, 'bn');
        for (const product of products.items) {
            const slugIn = (lang: Lang) =>
                product.translations.find(translation => translation.languageCode === lang)?.slug ??
                product.slug;
            entries.push({
                paths: { bn: productPath(slugIn('bn')), en: productPath(slugIn('en')) },
                lastmod: product.updatedAt,
            });
        }
        if (skip + 100 >= products.totalItems) break;
    }
    return entries;
}

export async function categoryEntries(): Promise<SitemapEntry[]> {
    // Paths need each language's breadcrumb slugs, so the list is read once per language.
    const byLang = {} as Record<Lang, Map<string, { path: string; updatedAt: string }>>;
    for (const lang of LANGS) {
        byLang[lang] = new Map();
        for (let skip = 0; ; skip += 100) {
            const { collections } = await shopQuery(SITEMAP_COLLECTIONS, { skip }, lang);
            for (const collection of collections.items) {
                const slugs = collection.breadcrumbs
                    .map(crumb => crumb.slug)
                    .filter(slug => slug !== '__root_collection__');
                if (slugs.length)
                    byLang[lang].set(collection.id, {
                        path: categoryPath(slugs),
                        updatedAt: collection.updatedAt,
                    });
            }
            if (skip + 100 >= collections.totalItems) break;
        }
    }
    return [...byLang.bn.entries()].map(([id, bn]) => ({
        paths: { bn: bn.path, en: byLang.en.get(id)?.path ?? bn.path },
        lastmod: bn.updatedAt,
    }));
}

export async function pageEntries(): Promise<SitemapEntry[]> {
    const { bdPages } = await shopQuery(SITEMAP_PAGES, {}, 'bn');
    const settings = await getSettings();
    const policies = Object.entries(settings.policies)
        .filter(([, text]) => text.bn || text.en)
        .map(([key]) => {
            const path = `/${POLICY_SLUGS[key as PolicyKey]}/`;
            return { paths: { bn: path, en: path } };
        });
    const pages = bdPages.map(page => {
        const slugIn = (lang: Lang) =>
            (
                page.translations.find(translation => translation.languageCode === lang) ??
                page.translations[0]!
            ).slug;
        return { paths: { bn: pagePath(slugIn('bn')), en: pagePath(slugIn('en')) }, lastmod: page.updatedAt };
    });
    return [{ paths: { bn: '/', en: '/' } }, ...policies, ...pages];
}

export async function sitemap(kind: 'products' | 'categories' | 'pages'): Promise<Response> {
    const load = { products: productEntries, categories: categoryEntries, pages: pageEntries }[kind];
    return xmlResponse(urlSet(await load(), env().SITE_URL, await defaultLang()));
}

import type { AstroGlobal } from 'astro';
import { env } from '../env';
import { formatter, LANGS, type Lang, t } from './i18n';
import { localePath } from './urls';

/** What every page template needs, from the middleware's locals. */
export function pageContext(Astro: AstroGlobal) {
    const { lang, defaultLang, settings } = Astro.locals;
    const site = env().SITE_URL;
    return {
        lang,
        defaultLang,
        settings,
        s: t(lang),
        format: formatter(lang, settings.locale.banglaDigits),
        /** A path in this page's language: `/product/x/` → `/en/product/x/` when English isn't the default. */
        href: (path: string, inLang: Lang = lang) => localePath(inLang, defaultLang, path),
        /** An absolute URL on the store, for canonicals, Open Graph and sitemaps. */
        absolute: (path: string) => (/^https?:\/\//.test(path) ? path : `${site}${path}`),
    };
}

/**
 * One 301 to the canonical URL when the request spelled it differently (no trailing slash,
 * capitals, another percent-encoding, the default language's prefix, an old slug). Query strings
 * are kept. Returns null when the request is already canonical.
 */
export function canonicalRedirect(Astro: AstroGlobal, canonicalPath: string): Response | null {
    const { lang, defaultLang, requestPath } = Astro.locals;
    const target = localePath(lang, defaultLang, canonicalPath);
    return requestPath === target ? null : Astro.redirect(`${target}${Astro.url.search}`, 301);
}

/** `hreflang` alternates: the page's path in each language that has it, plus x-default. */
export function alternates(
    Astro: AstroGlobal,
    pathByLang: Partial<Record<Lang, string>>,
): Array<{ hreflang: string; href: string }> {
    const { defaultLang } = Astro.locals;
    const { absolute } = pageContext(Astro);
    const links = LANGS.filter(lang => pathByLang[lang]).map(lang => ({
        hreflang: lang,
        href: absolute(localePath(lang, defaultLang, pathByLang[lang]!)),
    }));
    const fallback = pathByLang[defaultLang] ?? Object.values(pathByLang)[0];
    return fallback
        ? [
              ...links,
              { hreflang: 'x-default', href: absolute(localePath(defaultLang, defaultLang, fallback)) },
          ]
        : links;
}

/** Pages that change per visitor (cart, checkout, account, tracking, search): never cached, never indexed. */
export function privatePage(Astro: AstroGlobal) {
    Astro.response.headers.set('cache-control', 'no-store');
    Astro.response.headers.set('x-robots-tag', 'noindex');
}

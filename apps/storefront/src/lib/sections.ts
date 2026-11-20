import {
    type DataOf,
    defaultHomeLayout,
    eachNode,
    elementDefinition,
    type featuredProduct,
    LAYOUT_LIMITS,
    layoutCss,
    needsPageContent,
    splitAtContent,
    type SystemLayout,
    type LayoutDocument,
    type LinkValue,
    type productGrid,
    readDocument,
    readThemeSettings,
    type SectionData,
    shownSmartSections,
    type ThemeSettings,
} from '@ecommbd/sections';
import type { AstroGlobal } from 'astro';
import { createHash } from 'node:crypto';
import { env } from '../env';
import { clientIpOf, RateLimitedError, type ResultOf, shopQuery } from './core';
import type { AssetData } from './images';
import type { Lang } from './i18n';
import {
    BD_SEARCH,
    COLLECTIONS_BY_ID,
    FEATURED_PRODUCTS,
    LAYOUT,
    LAYOUT_PREVIEW,
    type ProductCardFields,
    PRODUCTS_BY_ID,
    THEME,
} from './queries';
import { dataCache, getTopCollections, type StoreSettings } from './store';
import { categoryPath, localePath } from './urls';

/**
 * Page sections on the storefront (roadmap phase 15): the published layout of a page (or a draft,
 * with a valid preview token), and everything its sections show, fetched in a few batched calls.
 */

export type LayoutKind = 'home' | 'page' | SystemLayout;
export type Card = ResultOf<typeof ProductCardFields>;
export type FeaturedProduct = ResultOf<typeof FEATURED_PRODUCTS>['products']['items'][number];
export type CollectionCard = ResultOf<typeof COLLECTIONS_BY_ID>['collections']['items'][number];

export interface Preview {
    mode: 'editor' | 'share';
    expiresAt: string;
    /** The layout being previewed: on a page that shows several, only its sections can be edited. */
    layoutId: string;
}

export interface LoadedLayout {
    document: LayoutDocument;
    assets: Map<string, AssetData>;
    /** For the `xkey` cache tags. Null for the built-in default. */
    layoutId: string | null;
}

/** The store's theme settings, through the data cache (tag `theme`). */
export function getTheme(): Promise<ThemeSettings> {
    return dataCache().get('theme', ['theme'], async () =>
        readThemeSettings((await shopQuery(THEME, {}, 'bn')).bdTheme),
    );
}

type LayoutResult = NonNullable<ResultOf<typeof LAYOUT>['bdLayout']>;

function loaded(layout: LayoutResult): LoadedLayout {
    return {
        // The core resolved each link's address in this language; rich text is sanitized when shown.
        document: readDocument(layout.document, { keepHrefs: true }),
        assets: new Map(layout.assets.map(asset => [asset.id, asset])),
        layoutId: layout.id,
    };
}

/**
 * The sections for this page: a draft when the URL has a valid `?preview=` token for this page
 * (the page is then never cached or indexed), else the published layout, else null (the home page
 * then shows its default). An expired or wrong token shows the live page with a notice.
 */
export async function loadLayout(
    Astro: AstroGlobal,
    kind: LayoutKind,
    pageId?: string,
): Promise<LoadedLayout | null> {
    const { lang } = Astro.locals;
    const token = Astro.url.searchParams.get('preview');
    if (token) {
        Astro.response.headers.set('cache-control', 'no-store');
        Astro.response.headers.set('x-robots-tag', 'noindex');
        // One page shows several layouts (its own, the header's, the footer's): the token is
        // looked up once, and is for whichever of them it names.
        Astro.locals.previewLookup ??= shopQuery(LAYOUT_PREVIEW, { token }, lang).then(
            result => result.bdLayoutPreview,
        );
        const found = await Astro.locals.previewLookup;
        const layout = found?.layout;
        if (found && layout) {
            // A wrong page for this token (a page's draft opened on another page) shows live.
            const mine = layout.type === kind && (kind !== 'page' || layout.pageId === pageId);
            const elsewhere =
                layout.type === 'page' || layout.type === 'home' || layout.type === 'landing'
                    ? kind === 'page' || kind === 'home'
                    : false;
            if (mine) {
                Astro.locals.preview = {
                    mode: found.mode === 'share' ? 'share' : 'editor',
                    expiresAt: found.expiresAt,
                    layoutId: layout.id,
                };
                return loaded(layout);
            }
            if (elsewhere) Astro.locals.previewExpired = true;
        } else {
            Astro.locals.previewExpired = true;
        }
    }
    const published = await dataCache().get(
        `layout:${kind}:${pageId ?? ''}:${lang}`,
        ['layouts'],
        async () => (await shopQuery(LAYOUT, { type: kind, pageId }, lang)).bdLayout,
    );
    return published ? loaded(published) : null;
}

/** The home page before the merchant publishes one (the same default the editor starts from). */
export function defaultHome(settings: StoreSettings): LoadedLayout {
    return {
        document: defaultHomeLayout({
            name: settings.profile.storeName,
            description: settings.profile.shortDescription,
        }),
        assets: new Map(),
        layoutId: null,
    };
}

/** Sections that show: not hidden, at most 40. */
export function visibleSections(document: LayoutDocument): SectionData[] {
    return document.sections.filter(section => !section.hidden).slice(0, LAYOUT_LIMITS.sections);
}

type Grid = DataOf<typeof productGrid>;
type Featured = DataOf<typeof featuredProduct>;

export interface SectionPageData {
    /** Products shown by each product grid, by section uid, in order. */
    grids: Map<string, Card[]>;
    /** Products that elements show (a product card, a product carousel, an add-to-cart button), by id. */
    cards: Map<string, Card>;
    featured: Map<string, FeaturedProduct>;
    collections: Map<string, CollectionCard>;
    topCollections: CollectionCard[];
    /** `product:<id>` and `collection:<id>` tags for the page (Varnish purging, phase 17). */
    tags: string[];
}

const SORTS = { newest: 'NEWEST', popular: 'POPULAR', collection: 'FEATURED' } as const;

/** Everything the page's sections show, in a few batched Shop API calls. */
export async function loadSectionData(Astro: AstroGlobal, shown: SectionData[]): Promise<SectionPageData> {
    const { lang } = Astro.locals;
    // The ready-made sections on the page and those inside free sections' live blocks (phase 56).
    const sections = shownSmartSections({ sections: shown });
    const clientIp = clientIpOf(Astro.request, () => Astro.clientAddress);
    const grids = sections.filter((section): section is Grid => section.type === 'product-grid');
    const featuredIds = sections
        .filter((section): section is Featured => section.type === 'featured-product')
        .map(section => section.settings.product)
        .filter((id): id is string => !!id);
    const collectionIds = new Set<string>();
    let wantsTopCollections = false;
    for (const section of sections) {
        if (section.type !== 'collection-list') continue;
        const ids = section.settings.collections as string[];
        if (ids.length) ids.forEach(id => collectionIds.add(id));
        else wantsTopCollections = true;
    }

    // Each grid's product IDs: picked by hand, or from search (newest, best selling, a category).
    const gridIds = await Promise.all(
        grids.map(async section => {
            const { source, products, collection, count } = section.settings;
            if (source === 'manual') return products;
            if (source === 'collection' && !collection) return [];
            try {
                const { bdSearch } = await shopQuery(
                    BD_SEARCH,
                    {
                        input: {
                            sort: SORTS[source],
                            take: count,
                            collectionId: source === 'collection' ? collection : null,
                        },
                    },
                    lang,
                    { clientIp },
                );
                return bdSearch.productIds;
            } catch (error) {
                // A busy search shouldn't take the whole home page down: the grid is just empty.
                if (error instanceof RateLimitedError) return [];
                throw error;
            }
        }),
    );
    // Products picked in elements of free sections (phase 61).
    const elementIds = new Set<string>();
    for (const section of shown) {
        for (const { node } of eachNode(section.children ?? [])) {
            if (node.hidden) continue;
            for (const [name, item] of Object.entries(elementDefinition(node.type)?.fields ?? {})) {
                const value = node.props[name];
                if (item.kind === 'product' && typeof value === 'string' && value) elementIds.add(value);
                if (item.kind === 'productList' && Array.isArray(value))
                    value.forEach(id => typeof id === 'string' && elementIds.add(id));
            }
        }
    }
    const cardIds = [...new Set([...gridIds.flat(), ...elementIds])];
    const [cards, featured, collections, topCollections] = await Promise.all([
        cardIds.length
            ? shopQuery(PRODUCTS_BY_ID, { ids: cardIds, take: cardIds.length }, lang).then(
                  result => result.products.items,
              )
            : [],
        featuredIds.length
            ? shopQuery(FEATURED_PRODUCTS, { ids: featuredIds, take: featuredIds.length }, lang).then(
                  result => result.products.items,
              )
            : [],
        collectionIds.size
            ? shopQuery(COLLECTIONS_BY_ID, { ids: [...collectionIds] }, lang).then(
                  result => result.collections.items,
              )
            : [],
        wantsTopCollections ? getTopCollections(lang) : [],
    ]);
    const byId = new Map(cards.map(card => [card.id, card]));
    const tags = new Set<string>();
    const gridMap = new Map<string, Card[]>();
    grids.forEach((section, index) => {
        const shown = gridIds[index]!.map(id => byId.get(id)).filter((card): card is Card => !!card);
        shown.forEach(card => tags.add(`product:${card.id}`));
        gridMap.set(section.uid, shown);
    });
    elementIds.forEach(id => byId.has(id) && tags.add(`product:${id}`));
    featured.forEach(product => tags.add(`product:${product.id}`));
    collections.forEach(collection => tags.add(`collection:${collection.id}`));
    // A grid filled from search (newest, best selling, a category) can change with any catalog
    // change, not just a change to the products it shows now; top categories with any category's.
    if (grids.some(section => section.settings.source !== 'manual')) tags.add('listing');
    if (wantsTopCollections) tags.add('collections');
    return {
        grids: gridMap,
        cards: byId,
        featured: new Map(featured.map(product => [product.id, product])),
        collections: new Map(collections.map(collection => [collection.id, collection])),
        // Top categories come from the menu query, without breadcrumbs: they're top level.
        topCollections: topCollections.map(collection => ({
            id: collection.id,
            name: collection.name,
            breadcrumbs: [{ slug: '__root_collection__' }, { slug: collection.slug }],
            featuredAsset: collection.featuredAsset,
        })),
        tags: [...tags],
    };
}

/** A category's path from its breadcrumbs (which start with Vendure's hidden root). */
export function collectionPath(collection: CollectionCard): string {
    return categoryPath(
        collection.breadcrumbs
            .map(crumb => crumb.slug)
            .filter(slug => slug && slug !== '__root_collection__'),
    );
}

/** Where a section's link goes, in this page's language; null when it goes nowhere. */
export function linkHref(
    link: LinkValue,
    context: { lang: Lang; defaultLang: Lang; settings: StoreSettings },
): string | null {
    if (link.type === 'whatsapp') {
        const number = context.settings.profile.whatsapp.replace(/\D/g, '');
        return number ? `https://wa.me/${number}` : null;
    }
    if (link.type === 'call') {
        const phone = context.settings.profile.phones[0];
        return phone ? `tel:${phone}` : null;
    }
    const href = link.href;
    if (!href) return null;
    return href.startsWith('/') ? localePath(context.lang, context.defaultLang, href) : href;
}

/**
 * `xkey` tags for a page with sections (phase 17): `layouts` (the core purges it when any layout
 * is published), this layout, `extra` from the page itself, then what the sections show. The
 * middleware adds the site-wide tags and keeps the header within its size (cache-policy.ts).
 */
export function setCacheTags(
    Astro: AstroGlobal,
    layout: LoadedLayout | null,
    data: SectionPageData | null,
    extra: string[] = [],
) {
    const tags = [
        'layouts',
        layout?.layoutId ? `layout:${layout.layoutId}` : 'layout:default',
        ...extra,
        ...(data?.tags ?? []),
    ];
    Astro.response.headers.set('xkey', [...new Set(tags)].join(' '));
}

/**
 * The page's generated stylesheet (phase 16): the sections' Design options and Custom section
 * elements, plus anything page-wide (a sales page's colours). Made from checked values only, and
 * allowed by its hash in the Content Security Policy (the middleware adds it). Call it in the
 * page's own frontmatter, before the response starts.
 */
export function pageStyle(Astro: AstroGlobal, document: LayoutDocument | null, extra = ''): string {
    const css = extra + (document ? layoutCss(document) : '');
    if (css) {
        const hash = createHash('sha256').update(css).digest('base64');
        Astro.locals.styleHashes = [...(Astro.locals.styleHashes ?? []), hash];
    }
    return css;
}

/** The admin's origin for the editor's frame (null: this site's own). */
export function editorOrigin(): string | null {
    return env().EDITOR_ORIGIN ?? null;
}

/**
 * A system page's sections around its own part (roadmap phase 60): what the merchant put above
 * and below the product, the product list, the cart, the checkout form, the receipt, the header
 * or the footer.
 */
export interface Area {
    kind: SystemLayout;
    before: LoadedLayout;
    after: LoadedLayout;
    /** The locked block's uid, for the editor's frame (null: the page has none). */
    contentUid: string | null;
    /**
     * Whether the store's own part shows. Always on the pages that need it; in the header and
     * footer only while their block is there.
     */
    standard: boolean;
    data: SectionPageData;
    css: string;
    layoutId: string | null;
}

/** The published (or previewed) layout of a system page; null when the merchant hasn't made one. */
export async function loadArea(Astro: AstroGlobal, kind: SystemLayout): Promise<Area | null> {
    const layout = await loadLayout(Astro, kind);
    if (!layout) return null;
    const split = splitAtContent({ sections: visibleSections(layout.document) });
    const standard = needsPageContent(kind) || !!split.content;
    const sections = [...split.before, ...split.after];
    // Nothing but the page's own part: the page as it always was (the editor still needs the
    // block marked, to select it).
    if (!sections.length && standard && Astro.locals.preview?.mode !== 'editor') return null;
    const part = (list: SectionData[]): LoadedLayout => ({ ...layout, document: { sections: list } });
    return {
        kind,
        before: part(split.before),
        after: part(split.after),
        contentUid: split.content?.uid ?? null,
        standard,
        data: await loadSectionData(Astro, sections),
        css: pageStyle(Astro, { sections }),
        layoutId: layout.layoutId,
    };
}

/** Adds an area's cache tags to the page's (its layout and what its sections show). */
export function addAreaTags(Astro: AstroGlobal, area: Area | null) {
    if (!area || Astro.locals.preview) return;
    const now = Astro.response.headers.get('xkey');
    const tags = [...(now ? now.split(' ') : []), 'layouts', `layout:${area.layoutId}`, ...area.data.tags];
    Astro.response.headers.set('xkey', [...new Set(tags)].join(' '));
}

/** The header and footer layouts, loaded by the middleware before the page renders. */
export interface Chrome {
    header: Area | null;
    footer: Area | null;
    /** Headers a preview sets (never cached, never indexed), for the middleware to pass on. */
    headers: Headers;
}

export async function loadChrome(context: {
    locals: App.Locals;
    url: URL;
    request: Request;
    clientAddress: string;
}): Promise<Chrome> {
    const headers = new Headers();
    // The loaders read the same few things from a page and from the middleware's context.
    const astro = {
        locals: context.locals,
        url: context.url,
        request: context.request,
        get clientAddress() {
            return context.clientAddress;
        },
        response: { headers },
    } as unknown as AstroGlobal;
    const [header, footer] = await Promise.all([loadArea(astro, 'header'), loadArea(astro, 'footer')]);
    return { header, footer, headers };
}

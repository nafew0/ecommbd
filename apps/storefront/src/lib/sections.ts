import {
    type DataOf,
    defaultHomeLayout,
    type featuredProduct,
    LAYOUT_LIMITS,
    type LayoutDocument,
    type LinkValue,
    type productGrid,
    readDocument,
    readThemeSettings,
    type SectionData,
    type ThemeSettings,
} from '@ecommbd/sections';
import type { AstroGlobal } from 'astro';
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

export type LayoutKind = 'home' | 'page' | 'product';
export type Card = ResultOf<typeof ProductCardFields>;
export type FeaturedProduct = ResultOf<typeof FEATURED_PRODUCTS>['products']['items'][number];
export type CollectionCard = ResultOf<typeof COLLECTIONS_BY_ID>['collections']['items'][number];

export interface Preview {
    mode: 'editor' | 'share';
    expiresAt: string;
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
        document: readDocument(layout.document),
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
        const { bdLayoutPreview } = await shopQuery(LAYOUT_PREVIEW, { token }, lang);
        const layout = bdLayoutPreview?.layout;
        if (
            bdLayoutPreview &&
            layout &&
            layout.type === kind &&
            (kind !== 'page' || layout.pageId === pageId)
        ) {
            Astro.locals.preview = {
                mode: bdLayoutPreview.mode === 'share' ? 'share' : 'editor',
                expiresAt: bdLayoutPreview.expiresAt,
            };
            return loaded(layout);
        }
        Astro.locals.previewExpired = true;
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
    featured: Map<string, FeaturedProduct>;
    collections: Map<string, CollectionCard>;
    topCollections: CollectionCard[];
    /** `product:<id>` and `collection:<id>` tags for the page (Varnish purging, phase 17). */
    tags: string[];
}

const SORTS = { newest: 'NEWEST', popular: 'POPULAR', collection: 'FEATURED' } as const;

/** Everything the page's sections show, in a few batched Shop API calls. */
export async function loadSectionData(Astro: AstroGlobal, sections: SectionData[]): Promise<SectionPageData> {
    const { lang } = Astro.locals;
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
    const cardIds = [...new Set(gridIds.flat())];
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
    featured.forEach(product => tags.add(`product:${product.id}`));
    collections.forEach(collection => tags.add(`collection:${collection.id}`));
    return {
        grids: gridMap,
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

/** `xkey` tags for a page with sections: the layout, then what it shows (at most 100). */
export function setCacheTags(Astro: AstroGlobal, layout: LoadedLayout | null, data: SectionPageData) {
    const tags = [layout?.layoutId ? `layout:${layout.layoutId}` : 'layout:default', 'theme', ...data.tags];
    Astro.response.headers.set('xkey', tags.slice(0, 100).join(' '));
}

/** The admin's origin for the editor's frame (null: this site's own). */
export function editorOrigin(): string | null {
    return env().EDITOR_ORIGIN ?? null;
}

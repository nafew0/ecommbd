import { readDocument, readSalesSettings, type SalesPageSettings } from '@ecommbd/sections';
import type { AstroGlobal } from 'astro';
import { formInteger } from './cart';
import { CHECKOUT_SETTINGS, DISTRICTS } from './checkout-queries';
import { type ResultOf, shopQuery } from './core';
import type { Lang, Strings } from './i18n';
import { LAYOUT_PREVIEW, SALES_PAGE } from './queries';
import type { LoadedLayout } from './sections';
import { dataCache } from './store';

/**
 * Sales pages on the storefront (roadmap phase 16): `/s/<slug>/`, cacheable like any page. The
 * order form posts to `/s/<slug>/order/`, which runs in a session of its own (`lp-session`), so the
 * shopper's cart is left alone.
 */

export type SalesPageData = NonNullable<ResultOf<typeof SALES_PAGE>['bdSalesPage']>;
export type SalesVariant = SalesPageData['product']['variants'][number];
export type SalesPack = SalesPageData['packs'][number];

export interface LoadedSalesPage {
    page: SalesPageData;
    settings: SalesPageSettings;
    layout: LoadedLayout;
}

/** The storefront's cache tag for sales pages (the core purges it when a page changes). */
export const SALES_CACHE_TAG = 'sales-pages';

function loaded(page: SalesPageData): LoadedSalesPage {
    return {
        page,
        settings: readSalesSettings(page.settings),
        layout: {
            document: readDocument(page.layout.document, { keepHrefs: true }),
            assets: new Map(page.layout.assets.map(asset => [asset.id, asset])),
            layoutId: page.layout.id,
        },
    };
}

/**
 * A sales page by its address: the published one (through the data cache), or its draft with a
 * valid preview link (never cached or indexed). Null when there's none, it's off, or its product
 * is gone.
 */
export async function loadSalesPage(Astro: AstroGlobal, slug: string): Promise<LoadedSalesPage | null> {
    const { lang } = Astro.locals;
    const token = Astro.url.searchParams.get('preview');
    if (token) {
        Astro.response.headers.set('cache-control', 'no-store');
        Astro.response.headers.set('x-robots-tag', 'noindex');
        const [{ bdSalesPage }, { bdLayoutPreview }] = await Promise.all([
            shopQuery(SALES_PAGE, { slug, preview: token }, lang),
            shopQuery(LAYOUT_PREVIEW, { token }, lang),
        ]);
        if (bdSalesPage?.preview && bdLayoutPreview) {
            Astro.locals.preview = {
                mode: bdLayoutPreview.mode === 'share' ? 'share' : 'editor',
                expiresAt: bdLayoutPreview.expiresAt,
            };
            return loaded(bdSalesPage);
        }
        Astro.locals.previewExpired = true;
    }
    const page = await dataCache().get(
        `sales:${encodeURIComponent(slug).slice(0, 300)}:${lang}`,
        [SALES_CACHE_TAG, 'layouts'],
        async () => (await shopQuery(SALES_PAGE, { slug }, lang)).bdSalesPage,
    );
    return page ? loaded(page) : null;
}

/** What the order form shows besides the page: the checkout's settings and the districts. */
export async function salesFormData(lang: Lang) {
    const [checkout, districts] = await Promise.all([
        dataCache().get(
            'checkout-settings',
            ['settings'],
            async () => (await shopQuery(CHECKOUT_SETTINGS, {}, lang)).bdCheckoutSettings,
        ),
        dataCache().get(
            `districts:${lang}`,
            ['geo'],
            async () => (await shopQuery(DISTRICTS, { lang }, lang)).bdDistricts,
        ),
    ]);
    return { checkout, districts };
}

/** The shopper's choice from the order form: a variant of this page's product, a pack or quantity, the add-on. */
export function readChoice(form: FormData, page: SalesPageData) {
    const variantId = form.get('variantId');
    const variant =
        page.product.variants.find(item => item.id === variantId) ?? startingVariant(page.product.variants);
    const quantity = formInteger(form.get('quantity'), 1, 99) ?? startingPack(page.packs)?.quantity ?? 1;
    return { variantId: variant?.id ?? '', quantity, bump: form.get('bump') === '1' && !!page.bump };
}

/** What to tell the shopper when the core refuses the page's order. */
export function salesOrderError(
    code: string,
    available: number | null,
    s: Strings,
    digits: (n: number) => string,
) {
    if (code === 'INVALID_PACK') return s.choosePackFirst;
    if (code === 'NOT_ENOUGH_STOCK') return available ? s.salesOnlyLeft(digits(available)) : s.onlyLeft(0);
    return s.salesNotAvailable;
}

/** The variant the form starts with: the default one in stock, else the first in stock, else the first. */
export function startingVariant(variants: SalesVariant[]): SalesVariant | undefined {
    const inStock = variants.filter(variant => variant.stockLevel !== 'OUT_OF_STOCK');
    return inStock.find(variant => variant.customFields?.isDefault) ?? inStock[0] ?? variants[0];
}

/** The pack the form starts with: the popular one, else the smallest, if stock allows. */
export function startingPack(packs: SalesPack[]): SalesPack | undefined {
    const available = packs.filter(pack => pack.available);
    return available.find(pack => pack.popular) ?? available[0];
}

/** Percent off, rounded down (a pack or price never claims more than it saves). */
export function percentOff(price: number, normal: number): number {
    return normal > price && normal > 0 ? Math.floor(((normal - price) / normal) * 100) : 0;
}

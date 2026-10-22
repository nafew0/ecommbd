import {
    defaultSalesSettings,
    fillFromProduct,
    landingTemplate,
    checkSalesSettings,
    pick,
    readSalesSettings,
    SALES_LIMITS,
    type SalesPageSettings,
    type SalesSettingsProblem,
    toSalesSlug,
} from '@ecommbd/sections';
import { cleanText, encodeSlug, endOfDhakaDay, fromDhaka, readAttribution } from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ActiveOrderService,
    AdministratorService,
    type Asset,
    ConfigService,
    type ID,
    isGraphQlErrorResult,
    Order,
    OrderService,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';
import { LayoutService, StorefrontPurger } from '../bd-sections';
import { MAX_ORDER_QUANTITY, MAX_SALES_PAGES, SALES_PAGES_CACHE_TAG } from './constants';
import { BdSalesPage } from './entities';

export const BD_SALES_PAGES_PLUGIN_OPTIONS = Symbol('BD_SALES_PAGES_PLUGIN_OPTIONS');

export interface BdSalesPagesPluginOptions {
    /** STOREFRONT_URL, for the pages' links in the admin; relative without it. */
    storefrontUrl?: string;
}

export interface SalesPageProblem {
    field: string;
    code: string;
    /** For a taken address: a free one. */
    suggestion?: string | null;
}

/** live: on the storefront; off: switched off; notPublished: never published; productMissing: its product is gone. */
export type SalesPageStatus = 'live' | 'off' | 'notPublished' | 'productMissing';

export interface SalesPageInput {
    title?: string | null;
    slug?: string | null;
    template?: string | null;
    productId?: ID | null;
    active?: boolean | null;
    settings?: unknown;
}

export type SalesOrderErrorCode =
    'NOT_AVAILABLE' | 'INVALID_VARIANT' | 'INVALID_PACK' | 'NOT_ENOUGH_STOCK' | 'ORDER_LOCKED';

const SLUG = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;
const cleanTitle = (title: string) => cleanText(title).slice(0, SALES_LIMITS.title);

/**
 * Sales pages (roadmap phase 16): made from a template and a product, edited in phase 15's page
 * editor (layout `landing:<id>`), and ordered from with packs and an add-on. Their orders and
 * attribution live on Vendure's Order (custom fields).
 */
@Injectable()
export class SalesPageService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private administrators: AdministratorService,
        private products: ProductService,
        private variants: ProductVariantService,
        private orders: OrderService,
        private activeOrders: ActiveOrderService,
        private moduleRef: ModuleRef,
        @Inject(BD_SALES_PAGES_PLUGIN_OPTIONS) private options: BdSalesPagesPluginOptions,
    ) {}

    // bd-sections' services, found like Vendure's own injector does (any module).
    private get layouts() {
        return this.moduleRef.get(LayoutService, { strict: false });
    }
    private get purger() {
        return this.moduleRef.get(StorefrontPurger, { strict: false });
    }

    // IDs in JSON aren't encoded and decoded by Vendure like typed ID arguments are.
    private encode = (id: string) =>
        String(this.configService.entityOptions.entityIdStrategy?.encodeId(id) ?? id);
    private decode = (id: string) =>
        String(this.configService.entityOptions.entityIdStrategy?.decodeId(id) ?? id);

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, BdSalesPage);
    }

    private async staffName(ctx: RequestContext): Promise<string> {
        if (!ctx.activeUserId) return '';
        const administrator = await this.administrators.findOneByUserId(ctx, ctx.activeUserId);
        return administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : '';
    }

    /** Settings as the admin and storefront see them: the add-on's variant ID encoded. */
    private encodeSettings(settings: SalesPageSettings): SalesPageSettings {
        const read = readSalesSettings(settings);
        return {
            ...read,
            bump: { ...read.bump, variantId: read.bump.variantId && this.encode(read.bump.variantId) },
        };
    }

    // ---- Admin ----

    async list(
        ctx: RequestContext,
        options: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        const qb = this.repo(ctx).createQueryBuilder('page').orderBy('page.updatedAt', 'DESC');
        const term = cleanText(options.search ?? '');
        if (term) {
            qb.where('(page.title ILIKE :like OR page.slug ILIKE :like)', {
                like: `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`,
            });
        }
        const [rows, totalItems] = await qb
            .skip(options.skip ?? 0)
            .take(Math.min(options.take ?? 25, 100))
            .getManyAndCount();
        return { items: await this.adminViews(ctx, rows), totalItems };
    }

    async findOne(ctx: RequestContext, id: ID) {
        const page = await this.repo(ctx).findOne({ where: { id } });
        return page ? (await this.adminViews(ctx, [page]))[0]! : null;
    }

    /** The pages as the admin lists them: product, status, link and orders placed from each. */
    private async adminViews(ctx: RequestContext, pages: BdSalesPage[]) {
        const productIds = [...new Set(pages.map(page => page.productId).filter((id): id is ID => !!id))];
        const products = productIds.length
            ? await this.connection.getRepository(ctx, Product).find({
                  where: { id: In(productIds), deletedAt: IsNull() },
                  select: ['id', 'enabled'],
              })
            : [];
        const live = new Map(products.map(product => [String(product.id), product]));
        const counts = await this.orderCounts(
            ctx,
            pages.map(page => String(page.id)),
        );
        const layouts = await Promise.all(
            pages.map(page => this.layouts.getOrCreate(ctx, 'landing', page.id)),
        );
        const base = (this.options.storefrontUrl ?? '').replace(/\/$/, '');
        return pages.map((page, index) => {
            const layout = layouts[index];
            const product = page.productId ? live.get(String(page.productId)) : undefined;
            const status: SalesPageStatus = !product
                ? 'productMissing'
                : !page.active
                  ? 'off'
                  : !layout?.publishedVersion
                    ? 'notPublished'
                    : 'live';
            return {
                id: page.id,
                title: page.title,
                slug: page.slug,
                template: page.template,
                active: page.active,
                productId: product ? page.productId : null,
                settings: this.encodeSettings(page.settings),
                layoutId: layout?.id ?? null,
                status,
                orderCount: counts.get(String(page.id)) ?? 0,
                url: `${base}/s/${encodeSlug(page.slug)}/`,
                createdBy: page.createdBy,
                createdAt: page.createdAt,
                updatedAt: page.updatedAt,
            };
        });
    }

    /** Placed orders per sales page. */
    private async orderCounts(ctx: RequestContext, pageIds: string[]): Promise<Map<string, number>> {
        if (!pageIds.length) return new Map();
        const rows = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .select('order.customFields.salesPageId', 'page')
            .addSelect('COUNT(*)', 'count')
            .where('order.orderPlacedAt IS NOT NULL')
            .andWhere('order.customFields.salesPageId IN (:...pageIds)', { pageIds })
            .groupBy('order.customFields.salesPageId')
            .getRawMany<{ page: string; count: string }>();
        return new Map(rows.map(row => [row.page, Number(row.count)]));
    }

    /** A free address like the one asked for: `chia-seed`, else `chia-seed-2`, `chia-seed-3`… */
    private async freeSlug(ctx: RequestContext, wanted: string, exceptId?: ID): Promise<string> {
        const base = wanted.slice(0, SALES_LIMITS.slug - 4) || 'offer';
        const taken = new Set(
            (
                await this.repo(ctx)
                    .createQueryBuilder('page')
                    .select(['page.id', 'page.slug'])
                    .where('page.slug = :base OR page.slug LIKE :like', { base, like: `${base}-%` })
                    .getMany()
            )
                .filter(page => String(page.id) !== String(exceptId))
                .map(page => page.slug),
        );
        if (!taken.has(wanted)) return wanted;
        for (let n = 2; n < 1000; n++) {
            if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
        }
        return `${base}-${Date.now()}`;
    }

    /** The slug as typed (or from the title), checked: invalid, or taken with a suggestion. */
    private async checkSlug(ctx: RequestContext, input: string, exceptId?: ID) {
        const slug = toSalesSlug(input);
        if (!slug || !SLUG.test(slug)) return { slug, problem: { field: 'slug', code: 'invalid' } };
        const free = await this.freeSlug(ctx, slug, exceptId);
        return free === slug
            ? { slug, problem: null }
            : { slug, problem: { field: 'slug', code: 'taken', suggestion: free } };
    }

    private async liveProduct(ctx: RequestContext, productId: ID) {
        const product = await this.products.findOne(ctx, productId, ['featuredAsset', 'variants']);
        return product && !product.deletedAt ? product : undefined;
    }

    /** A pack of 1 at the normal price, 2 at 5% off and 3 at 10% off, in whole tens of taka. */
    private suggestedPacks(unitPrice: number): SalesPageSettings['packs'] {
        if (!unitPrice) return [];
        const pack = (quantity: number, off: number) =>
            Math.max(100, Math.floor((unitPrice * quantity * (1 - off)) / 1000) * 1000);
        return [
            { quantity: 1, price: unitPrice, label: { bn: '', en: '' }, popular: false },
            { quantity: 2, price: pack(2, 0.05), label: { bn: '', en: '' }, popular: true },
            { quantity: 3, price: pack(3, 0.1), label: { bn: '', en: '' }, popular: false },
        ];
    }

    /** A new page from a template and a product: sections filled from the product, packs suggested. */
    async create(ctx: RequestContext, input: SalesPageInput) {
        const errors: SalesPageProblem[] = [];
        const title = cleanTitle(input.title ?? '');
        if (!title) errors.push({ field: 'title', code: 'required' });
        const template = landingTemplate(input.template ?? '');
        if (!template) errors.push({ field: 'template', code: 'invalid' });
        const product = input.productId ? await this.liveProduct(ctx, input.productId) : undefined;
        if (!product) errors.push({ field: 'productId', code: 'required' });
        const { slug, problem } = await this.checkSlug(ctx, input.slug || title);
        if (problem) errors.push(problem);
        if ((await this.repo(ctx).count()) >= MAX_SALES_PAGES)
            errors.push({ field: 'title', code: 'tooMany' });
        if (errors.length || !template || !product) return { page: null, errors };

        const names = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: product.id },
            relations: ['translations', 'customFields.feedbackAssets'],
        });
        const name = (language: string) =>
            names?.translations.find(item => item.languageCode === language)?.name ?? '';
        const fields = (names?.customFields ?? {}) as {
            youtubeUrl?: string | null;
            feedbackAssets?: Asset[];
        };
        const document = fillFromProduct(template.build({ name: { bn: name('bn'), en: name('en') } }), {
            video: fields.youtubeUrl,
            reviews: (fields.feedbackAssets ?? []).map(asset => ({
                assetId: String(asset.id),
                preview: asset.preview,
            })),
        });
        const variants = product.variants.filter(variant => variant.enabled && !variant.deletedAt);
        const prices = await Promise.all(
            variants.map(async variant => (await this.variants.findOne(ctx, variant.id))?.priceWithTax ?? 0),
        );
        const settings = defaultSalesSettings();
        settings.packs = this.suggestedPacks(Math.min(...prices.filter(price => price > 0), Infinity) || 0);
        settings.seo.title = { bn: name('bn'), en: name('en') };

        const page = await this.repo(ctx).save(
            new BdSalesPage({
                title,
                slug,
                template: template.id,
                productId: product.id,
                settings,
                active: true,
                createdBy: await this.staffName(ctx),
            }),
        );
        await this.layouts.createOwned(ctx, 'landing', page.id, document);
        return { page: await this.findOne(ctx, page.id), errors: [] };
    }

    /** Title, address, product, on/off and the page settings; only what's given changes. */
    async update(ctx: RequestContext, id: ID, input: SalesPageInput) {
        const page = await this.repo(ctx).findOne({ where: { id } });
        if (!page) return { page: null, errors: [{ field: 'id', code: 'notFound' }] };
        const errors: SalesPageProblem[] = [];
        if (input.title != null) {
            page.title = cleanTitle(input.title);
            if (!page.title) errors.push({ field: 'title', code: 'required' });
        }
        if (input.slug != null && toSalesSlug(input.slug) !== page.slug) {
            const { slug, problem } = await this.checkSlug(ctx, input.slug, page.id);
            if (problem) errors.push(problem);
            page.slug = slug;
        }
        if (input.productId != null) {
            const product = await this.liveProduct(ctx, input.productId);
            if (!product) errors.push({ field: 'productId', code: 'required' });
            else page.productId = product.id;
        }
        if (input.active != null) page.active = input.active;
        if (input.settings !== undefined && input.settings !== null) {
            const { settings, problems } = await this.checkSettings(ctx, input.settings, page.productId);
            errors.push(...problems);
            page.settings = settings;
        }
        if (errors.length) return { page: null, errors };
        await this.repo(ctx).save(page);
        await this.purge();
        return { page: await this.findOne(ctx, page.id), errors: [] };
    }

    /** The settings read and checked; the add-on must be another product's variant that exists. */
    private async checkSettings(ctx: RequestContext, input: unknown, productId: ID | null) {
        const { settings, errors } = checkSalesSettings(input);
        const problems: SalesPageProblem[] = errors.map((error: SalesSettingsProblem) => ({
            field: `settings.${error.path}`,
            code: error.code,
        }));
        if (settings.bump.variantId) {
            settings.bump.variantId = this.decode(settings.bump.variantId);
            const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
                where: { id: settings.bump.variantId, deletedAt: IsNull() },
                select: ['id', 'productId'],
            });
            if (!variant) problems.push({ field: 'settings.bump', code: 'bumpMissing' });
            else if (productId && String(variant.productId) === String(productId)) {
                problems.push({ field: 'settings.bump', code: 'bumpSameProduct' });
            }
        }
        return { settings, problems };
    }

    /** A copy for another campaign: "(copy)" title, a free address, and the sections as a draft. */
    async duplicate(ctx: RequestContext, id: ID) {
        const source = await this.repo(ctx).findOne({ where: { id } });
        if (!source) return { page: null, errors: [{ field: 'id', code: 'notFound' }] };
        const slug = await this.freeSlug(ctx, `${source.slug.slice(0, SALES_LIMITS.slug - 10)}-copy`);
        const page = await this.repo(ctx).save(
            new BdSalesPage({
                title: `${source.title} (copy)`.slice(0, SALES_LIMITS.title),
                slug,
                template: source.template,
                productId: source.productId,
                settings: source.settings,
                active: true,
                createdBy: await this.staffName(ctx),
            }),
        );
        const draft = await this.layouts.ownedDraft(ctx, 'landing', source.id);
        await this.layouts.createOwned(ctx, 'landing', page.id, draft ?? { sections: [] });
        return { page: await this.findOne(ctx, page.id), errors: [] };
    }

    async delete(ctx: RequestContext, id: ID): Promise<boolean> {
        const page = await this.repo(ctx).findOne({ where: { id } });
        if (!page) return false;
        await this.layouts.deleteOwned(ctx, 'landing', page.id);
        await this.repo(ctx).delete(page.id);
        await this.purge();
        return true;
    }

    /** The page editor's title and preview address for a sales page's layout. */
    async ownerTitle(ctx: RequestContext, id: ID) {
        return (await this.repo(ctx).findOne({ where: { id }, select: ['id', 'title'] }))?.title ?? '';
    }

    async ownerPath(ctx: RequestContext, id: ID) {
        const page = await this.repo(ctx).findOne({ where: { id }, select: ['id', 'slug'] });
        return page ? `/s/${encodeSlug(page.slug)}/` : '/';
    }

    private purge() {
        return this.purger.purge([SALES_PAGES_CACHE_TAG]);
    }

    // ---- Shop ----

    /**
     * A page for the storefront by its address: settings, product, packs that stock allows, the
     * add-on while it's in stock, and the published sections. With a valid preview link for this
     * page: the draft, even while the page is off or unpublished. Null for anything else.
     */
    async shopPage(ctx: RequestContext, slug: string, previewToken?: string | null) {
        const page = await this.repo(ctx).findOne({ where: { slug: slug.normalize('NFC') } });
        if (!page) return null;
        const own = await this.layouts.getOrCreate(ctx, 'landing', page.id);
        const preview = previewToken ? await this.layouts.preview(ctx, previewToken) : null;
        const previewing = !!preview && !!own && String(preview.layout.id) === String(own.id);
        const product = page.productId ? await this.liveProduct(ctx, page.productId) : undefined;
        if (!product || (!previewing && (!page.active || !product.enabled))) return null;
        const layout =
            previewing && preview ? preview.layout : await this.layouts.published(ctx, 'landing', page.id);
        if (!layout) return null;

        const settings = readSalesSettings(page.settings);
        const variants = (
            await Promise.all(
                product.variants
                    .filter(variant => variant.enabled && !variant.deletedAt)
                    .map(variant => this.variants.findOne(ctx, variant.id)),
            )
        ).filter((variant): variant is NonNullable<typeof variant> => !!variant);
        const stock = await Promise.all(
            variants.map(variant => this.variants.getSaleableStockLevel(ctx, variant)),
        );
        const most = Math.max(0, ...stock);
        const unitPrice = variants[0]?.priceWithTax ?? 0;
        const label = (text: { bn: string; en: string }) =>
            pick(text, ctx.languageCode === 'en' ? 'en' : 'bn');

        let bump = null;
        if (settings.bump.enabled && settings.bump.variantId && settings.bump.price) {
            const variant = await this.variants.findOne(ctx, settings.bump.variantId, ['product']);
            const inStock =
                variant?.enabled &&
                !variant.deletedAt &&
                variant.product.enabled &&
                !variant.product.deletedAt &&
                (await this.variants.getSaleableStockLevel(ctx, variant)) > 0;
            if (variant && inStock) {
                bump = {
                    variant,
                    price: settings.bump.price,
                    normalPrice: variant.priceWithTax,
                    title: label(settings.bump.title) || variant.name,
                    text: label(settings.bump.text),
                };
            }
        }
        return {
            id: page.id,
            slug: page.slug,
            title: page.title,
            settings: this.encodeSettings(settings),
            product,
            available: product.enabled && most > 0,
            maxQuantity: Math.min(MAX_ORDER_QUANTITY, most),
            packs: settings.packs.map(pack => ({
                quantity: pack.quantity,
                price: pack.price,
                normalPrice: unitPrice * pack.quantity,
                label: label(pack.label),
                popular: pack.popular,
                available: pack.quantity <= most,
            })),
            bump,
            layout,
            preview: previewing,
        };
    }

    /**
     * Puts a sales page order in the shopper's (sales page) cart: the chosen variant, the pack's
     * quantity (or one to 20 without packs) and the add-on, replacing whatever was there. Prices
     * come from the "Sales page offer" promotion, never from the browser.
     */
    async setOrder(
        ctx: RequestContext,
        input: { slug: string; variantId: ID; quantity: number; bump?: boolean | null },
    ): Promise<{
        order: Order | null;
        errorCode: SalesOrderErrorCode | null;
        quantityAvailable: number | null;
    }> {
        const fail = (errorCode: SalesOrderErrorCode, quantityAvailable: number | null = null) => ({
            order: null,
            errorCode,
            quantityAvailable,
        });
        const page = await this.repo(ctx).findOne({ where: { slug: input.slug.normalize('NFC') } });
        const product = page?.productId ? await this.liveProduct(ctx, page.productId) : undefined;
        if (!page?.active || !product?.enabled) return fail('NOT_AVAILABLE');
        if (!(await this.layouts.published(ctx, 'landing', page.id))) return fail('NOT_AVAILABLE');
        const variant = product.variants.find(
            item => String(item.id) === String(input.variantId) && item.enabled && !item.deletedAt,
        );
        if (!variant) return fail('INVALID_VARIANT');
        const settings = readSalesSettings(page.settings);
        const quantity = Math.floor(input.quantity);
        const allowed = settings.packs.length
            ? settings.packs.some(pack => pack.quantity === quantity)
            : quantity >= 1 && quantity <= MAX_ORDER_QUANTITY;
        if (!allowed) return fail('INVALID_PACK');

        let order = await this.activeOrders.getActiveOrder(ctx, undefined, true);
        if (order.state === 'ArrangingPayment') {
            const back = await this.orders.transitionToState(ctx, order.id, 'AddingItems');
            if (isGraphQlErrorResult(back)) return fail('ORDER_LOCKED');
            order = back;
        }
        if (order.state !== 'AddingItems') return fail('ORDER_LOCKED');
        // The page first, so the offer applies as the items go in.
        await this.orders.updateCustomFields(ctx, order.id, { salesPageId: String(page.id) });
        await this.orders.removeAllItemsFromOrder(ctx, order.id);
        const added = await this.orders.addItemToOrder(ctx, order.id, variant.id, quantity);
        if (isGraphQlErrorResult(added)) {
            await this.orders.removeAllItemsFromOrder(ctx, order.id);
            const available = 'quantityAvailable' in added ? Number(added.quantityAvailable) : 0;
            return fail('NOT_ENOUGH_STOCK', available);
        }
        const bumpId = settings.bump.enabled && settings.bump.price ? settings.bump.variantId : null;
        if (input.bump && bumpId) {
            // Sold out since the page loaded: the order goes ahead without it.
            const withBump = await this.orders.addItemToOrder(ctx, order.id, bumpId, 1);
            if (isGraphQlErrorResult(withBump)) {
                const line = (await this.orders.findOne(ctx, order.id))?.lines.find(
                    item => String(item.productVariantId) === String(bumpId),
                );
                if (line) await this.orders.removeItemFromOrder(ctx, order.id, line.id);
            }
        }
        return {
            order: (await this.orders.findOne(ctx, order.id)) ?? null,
            errorCode: null,
            quantityAvailable: null,
        };
    }

    /**
     * Copies the shopper's attribution (the storefront's cookie) onto their active order. The sales
     * page an ad led to counts for an order placed through the normal checkout too.
     */
    async setAttribution(ctx: RequestContext, input: unknown): Promise<boolean> {
        const order = await this.activeOrders.getActiveOrder(ctx, undefined);
        if (!order?.active) return false;
        const attribution = readAttribution(input);
        if (!attribution) return true;
        const fields: Record<string, string | Date | null> = {
            utmSource: attribution.source || null,
            utmMedium: attribution.medium || null,
            utmCampaign: attribution.campaign || null,
            utmContent: attribution.content || null,
            utmTerm: attribution.term || null,
            fbclid: attribution.fbclid || null,
            gclid: attribution.gclid || null,
            ttclid: attribution.ttclid || null,
            referrer: attribution.referrer || null,
            attributedAt: attribution.at ? new Date(attribution.at) : null,
        };
        const current = (order.customFields as { salesPageId?: string | null }).salesPageId;
        if (!current && attribution.salesPage) {
            const id = this.decode(attribution.salesPage);
            if (/^\d+$/.test(id) && (await this.repo(ctx).count({ where: { id } }))) fields.salesPageId = id;
        }
        await this.orders.updateCustomFields(ctx, order.id, fields);
        return true;
    }

    // ---- Reports ----

    /** The sales page an order came from, for the order screen (null when none, or deleted). */
    async pageOf(ctx: RequestContext, order: Order) {
        const id = (order.customFields as { salesPageId?: string | null }).salesPageId;
        if (!id || !/^\d+$/.test(id)) return null;
        return this.repo(ctx).findOne({ where: { id }, select: ['id', 'title', 'slug'] });
    }

    /**
     * Placed orders per campaign (source, medium, campaign) and sales page, for Dhaka days, most
     * orders first; values only with ReadSalesFigures. Full reports are phase 41.
     */
    async campaigns(
        ctx: RequestContext,
        options: { dateFrom?: string | null; dateTo?: string | null },
        canSeeSales: boolean,
    ) {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .select('order.customFields.utmSource', 'source')
            .addSelect('order.customFields.utmMedium', 'medium')
            .addSelect('order.customFields.utmCampaign', 'campaign')
            .addSelect('order.customFields.salesPageId', 'page')
            .addSelect('COUNT(*)', 'orders')
            .addSelect('COALESCE(SUM("order"."subTotalWithTax" + "order"."shippingWithTax"), 0)', 'value')
            .where('order.orderPlacedAt IS NOT NULL')
            .andWhere("order.state != 'Cancelled'")
            .andWhere(
                '(order.customFields.utmSource IS NOT NULL OR order.customFields.utmCampaign IS NOT NULL OR order.customFields.salesPageId IS NOT NULL OR order.customFields.referrer IS NOT NULL)',
            );
        if (options.dateFrom)
            qb.andWhere('order.orderPlacedAt >= :from', { from: dhakaDay(options.dateFrom) });
        if (options.dateTo)
            qb.andWhere('order.orderPlacedAt < :to', { to: endOfDhakaDay(dhakaDay(options.dateTo)) });
        const rows = await qb
            .groupBy('order.customFields.utmSource')
            .addGroupBy('order.customFields.utmMedium')
            .addGroupBy('order.customFields.utmCampaign')
            .addGroupBy('order.customFields.salesPageId')
            .orderBy('orders', 'DESC')
            .limit(200)
            .getRawMany<{
                source: string | null;
                medium: string | null;
                campaign: string | null;
                page: string | null;
                orders: string;
                value: string;
            }>();
        const pageIds = [
            ...new Set(rows.map(row => row.page).filter((id): id is string => !!id && /^\d+$/.test(id))),
        ];
        const pages = pageIds.length
            ? await this.repo(ctx).find({ where: { id: In(pageIds) }, select: ['id', 'title', 'slug'] })
            : [];
        const byId = new Map(pages.map(page => [String(page.id), page]));
        return rows.map(row => ({
            source: row.source ?? '',
            medium: row.medium ?? '',
            campaign: row.campaign ?? '',
            salesPage: row.page ? (byId.get(row.page) ?? null) : null,
            orders: Number(row.orders),
            value: canSeeSales ? Number(row.value) : null,
        }));
    }
}

/** `2026-10-21` (a Dhaka calendar day) → 00:00 Dhaka time that day, as UTC. */
function dhakaDay(date: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new UserInputError('error.bd-orders.invalid-date');
    return fromDhaka(Number(match[1]), Number(match[2]), Number(match[3]));
}

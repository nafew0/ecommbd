import {
    parseProductForm,
    type ProductForm,
    type SettingsFieldError,
    slugify,
    type VariationType,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Collection,
    ConfigService,
    type ID,
    isGraphQlErrorResult,
    LanguageCode,
    Product,
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull } from 'typeorm';
import { StockService } from './stock.service';

/** A pre-order variant can go this far below zero. */
const BACKORDER_THRESHOLD = -1_000_000;

const GROUP_NAMES: Record<Exclude<VariationType, 'none' | 'custom'>, { bn: string; en: string }> = {
    size: { bn: 'সাইজ', en: 'Size' },
    colour: { bn: 'রং', en: 'Colour' },
    pack: { bn: 'প্যাক', en: 'Pack' },
};

export type SaveProductResult =
    { product: ProductForm; errors: [] } | { product: null; errors: SettingsFieldError[] };

type Bilingual = { bn: string; en: string };

/** Translations for the languages that have text; Vendure falls back to the other one. */
function translations<T extends object>(value: Bilingual, extra: (language: 'bn' | 'en') => T) {
    return (['bn', 'en'] as const)
        .filter(language => value[language])
        .map(language => ({
            languageCode: LanguageCode[language],
            name: value[language],
            ...extra(language),
        }));
}

/**
 * The form's IDs (product, images, category, variants) through `map`. Vendure's API already
 * encodes keys named `id` inside JSON results (not the others, and nothing in JSON arguments), so
 * `idKeys: false` leaves those to it.
 */
function mapIds(form: ProductForm, map: (id: string) => string, idKeys: boolean): ProductForm {
    const one = (id: string | null) => (id ? map(id) : null);
    const key = (id: string | null) => (idKeys ? one(id) : id);
    return {
        ...form,
        id: key(form.id),
        featuredAssetId: one(form.featuredAssetId),
        galleryAssetIds: form.galleryAssetIds.map(map),
        feedbackAssetIds: form.feedbackAssetIds.map(map),
        categoryId: one(form.categoryId),
        variants: form.variants.map(variant => ({
            ...variant,
            id: key(variant.id),
            assetId: one(variant.assetId),
        })),
    };
}

/** A variant's price in the request's channel (a repository load doesn't fill `variant.price`). */
export function channelPrice(ctx: RequestContext, variant: ProductVariant): number {
    const prices = variant.productVariantPrices ?? [];
    return (prices.find(price => String(price.channelId) === String(ctx.channelId)) ?? prices[0])?.price ?? 0;
}

const pick = (list: Array<{ languageCode: string }> | undefined, language: 'bn' | 'en') =>
    list?.find(item => item.languageCode === language) as Record<string, unknown> | undefined;

/**
 * The one-page product form (phase 05): load a product as the form's shape, and save the whole form
 * (product, variation group and options, variants, stock) in one transaction. Bangla and English go
 * into Vendure's translations; one variation dimension (size, colour, pack or custom) as the
 * reference store uses.
 */
@Injectable()
export class ProductFormService {
    constructor(
        private connection: TransactionalConnection,
        private products: ProductService,
        private variants: ProductVariantService,
        private groups: ProductOptionGroupService,
        private options: ProductOptionService,
        private stockLevels: StockLevelService,
        private stock: StockService,
        private configService: ConfigService,
    ) {}

    /**
     * The form is JSON, which Vendure's API doesn't translate IDs inside, so the configured ID
     * strategy is applied here: IDs leave encoded and come back decoded, like every other API field.
     */
    async load(ctx: RequestContext, productId: ID): Promise<ProductForm | null> {
        const form = await this.loadRaw(ctx, productId);
        const strategy = this.configService.entityOptions.entityIdStrategy!;
        return form && mapIds(form, id => String(strategy.encodeId(id as never)), false);
    }

    private async loadRaw(ctx: RequestContext, productId: ID): Promise<ProductForm | null> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId, deletedAt: IsNull() },
            relations: {
                translations: true,
                featuredAsset: true,
                assets: { asset: true },
                optionGroups: { translations: true },
                variants: {
                    translations: true,
                    options: { translations: true },
                    featuredAsset: true,
                    productVariantPrices: true,
                },
                customFields: { category: true, feedbackAssets: true },
            } as never,
        });
        if (!product) return null;
        const text = (field: string, language: 'bn' | 'en') => {
            const translation = pick(product.translations, language);
            const value = field.startsWith('cf:')
                ? (translation?.customFields as Record<string, unknown> | undefined)?.[field.slice(3)]
                : translation?.[field];
            return typeof value === 'string' ? value : '';
        };
        const bilingual = (field: string) => ({ bn: text(field, 'bn'), en: text(field, 'en') });
        const group = product.optionGroups[0];
        const variationType = (group?.code.split(':')[1] as VariationType | undefined) ?? 'none';
        const fields = product.customFields;
        const variants = product.variants
            .filter(variant => !variant.deletedAt)
            .sort((a, b) => Number(a.id) - Number(b.id));
        return {
            id: String(product.id),
            name: bilingual('name'),
            shortDescription: bilingual('cf:shortDescription'),
            description: bilingual('description'),
            enabled: product.enabled,
            featuredAssetId: product.featuredAsset ? String(product.featuredAsset.id) : null,
            galleryAssetIds: product.assets
                .sort((a, b) => a.position - b.position)
                .map(item => String(item.assetId))
                .filter(id => id !== String(product.featuredAssetId)),
            feedbackAssetIds: ((fields.feedbackAssets as Array<{ id: ID }> | undefined) ?? []).map(asset =>
                String(asset.id),
            ),
            youtubeUrl: fields.youtubeUrl ?? '',
            featured: fields.featured ?? false,
            isNew: fields.isNew ?? false,
            categoryId: (fields.category as { id: ID } | null | undefined)?.id
                ? String((fields.category as { id: ID }).id)
                : null,
            delivery: {
                free: fields.freeDelivery ?? false,
                insideDhaka: fields.deliveryInsideDhaka ?? null,
                outsideDhaka: fields.deliveryOutsideDhaka ?? null,
                surcharge: fields.deliverySurcharge ?? 0,
            },
            seo: { title: bilingual('cf:seoTitle'), description: bilingual('cf:seoDescription') },
            variationType,
            variationName: {
                bn: String(pick(group?.translations, 'bn')?.name ?? ''),
                en: String(pick(group?.translations, 'en')?.name ?? ''),
            },
            variants: await Promise.all(
                variants.map(async variant => {
                    const option = variant.options[0];
                    const { stockOnHand } = await this.stockLevels.getAvailableStock(ctx, variant.id);
                    return {
                        id: String(variant.id),
                        option: {
                            bn: String(pick(option?.translations, 'bn')?.name ?? ''),
                            en: String(pick(option?.translations, 'en')?.name ?? ''),
                        },
                        sku: variant.sku,
                        price: channelPrice(ctx, variant),
                        oldPrice: variant.customFields.oldPrice ?? null,
                        stock: stockOnHand,
                        assetId: variant.featuredAsset ? String(variant.featuredAsset.id) : null,
                        isDefault: variant.customFields.isDefault ?? false,
                        enabled: variant.enabled,
                        allowBackorder:
                            !variant.useGlobalOutOfStockThreshold && variant.outOfStockThreshold < 0,
                        weightGrams: variant.customFields.weightGrams ?? null,
                    };
                }),
            ),
        };
    }

    async save(ctx: RequestContext, input: unknown): Promise<SaveProductResult> {
        const parsed = parseProductForm(input);
        if (!parsed.ok) {
            return { product: null, errors: parsed.errors };
        }
        const strategy = this.configService.entityOptions.entityIdStrategy!;
        // Decoded IDs keep the strategy's own type (numbers by default): TypeORM treats "1" and 1 as
        // different rows when saving, and would try to insert instead of update.
        const form = mapIds(parsed.product, id => strategy.decodeId(id) as unknown as string, true);
        if (form.categoryId) {
            const category = await this.connection
                .getRepository(ctx, Collection)
                .findOne({ where: { id: form.categoryId } });
            if (!category?.customFields.bdCategory) {
                return { product: null, errors: [{ path: 'categoryId', code: 'notFound' }] };
            }
        }
        const productId = await this.connection.withTransaction(ctx, txCtx => this.write(txCtx, form));
        return { product: (await this.load(ctx, productId))!, errors: [] };
    }

    private async write(ctx: RequestContext, form: ProductForm): Promise<ID> {
        const slug = slugify(form.name.en) || slugify(form.seo.title.en) || `p-${Date.now().toString(36)}`;
        const productInput = {
            enabled: form.enabled,
            featuredAssetId: form.featuredAssetId ?? undefined,
            assetIds: [
                ...new Set(
                    [form.featuredAssetId, ...form.galleryAssetIds].filter((id): id is string => !!id),
                ),
            ],
            translations: translations(form.name, language => ({
                slug,
                description: form.description[language] || form.description.bn || form.description.en,
                customFields: {
                    shortDescription: form.shortDescription[language] || null,
                    seoTitle: form.seo.title[language] || null,
                    seoDescription: form.seo.description[language] || null,
                },
            })),
            customFields: {
                featured: form.featured,
                isNew: form.isNew,
                youtubeUrl: form.youtubeUrl || null,
                categoryId: form.categoryId,
                feedbackAssetsIds: form.feedbackAssetIds,
                freeDelivery: form.delivery.free,
                deliveryInsideDhaka: form.delivery.insideDhaka,
                deliveryOutsideDhaka: form.delivery.outsideDhaka,
                deliverySurcharge: form.delivery.surcharge,
            },
        };
        let productId: ID;
        if (form.id) {
            await this.products.update(ctx, { id: form.id, ...productInput });
            productId = form.id;
        } else {
            productId = (await this.products.create(ctx, productInput)).id;
        }
        const optionIds = await this.syncOptions(ctx, productId, form);
        await this.syncVariants(ctx, productId, form, optionIds);
        return productId;
    }

    /** The variation group and its options; returns each variant's option ID (by index). */
    private async syncOptions(
        ctx: RequestContext,
        productId: ID,
        form: ProductForm,
    ): Promise<Array<ID | undefined>> {
        const product = await this.connection.getRepository(ctx, Product).findOneOrFail({
            where: { id: productId },
            relations: { optionGroups: { options: { translations: true } }, variants: true },
        });
        const code = `${productId}:${form.variationType}`;
        let group: ProductOptionGroup | undefined = product.optionGroups[0];
        if (group && group.code !== code) {
            // The kind of variation changed (e.g. size → colour): the old variants and group go.
            for (const variant of product.variants.filter(v => !v.deletedAt)) {
                await this.variants.softDelete(ctx, variant.id);
            }
            form.variants = form.variants.map(variant => ({ ...variant, id: null }));
            const removed = await this.products.removeOptionGroupFromProduct(ctx, productId, group.id, true);
            if (isGraphQlErrorResult(removed)) throw new Error(removed.message);
            group = undefined;
        }
        if (form.variationType === 'none') {
            return form.variants.map(() => undefined);
        }
        const groupName =
            form.variationType === 'custom' ? form.variationName : GROUP_NAMES[form.variationType];
        if (!group) {
            group = await this.groups.create(ctx, {
                code,
                translations: translations(groupName, () => ({})),
            });
            await this.products.addOptionGroupToProduct(ctx, productId, group.id);
        } else {
            await this.groups.update(ctx, {
                id: group.id,
                translations: translations(groupName, () => ({})),
            });
        }
        const existing = group.options ?? [];
        const ids: ID[] = [];
        for (const variant of form.variants) {
            const optionCode =
                slugify(variant.option.en) ||
                slugify(variant.option.bn) ||
                Buffer.from(variant.option.bn).toString('hex').slice(0, 40);
            const found = existing.find(option => option.code === optionCode);
            const optionTranslations = translations(variant.option, () => ({}));
            if (found) {
                await this.options.update(ctx, { id: found.id, translations: optionTranslations });
                ids.push(found.id);
            } else {
                const created = await this.options.create(ctx, group, {
                    code: optionCode,
                    translations: optionTranslations,
                });
                existing.push(created);
                ids.push(created.id);
            }
        }
        return ids;
    }

    private async syncVariants(
        ctx: RequestContext,
        productId: ID,
        form: ProductForm,
        optionIds: Array<ID | undefined>,
    ) {
        const current = await this.connection
            .getRepository(ctx, ProductVariant)
            .find({ where: { productId, deletedAt: IsNull() } });
        const kept = new Set(form.variants.filter(variant => variant.id).map(variant => String(variant.id)));
        for (const variant of current.filter(v => !kept.has(String(v.id)))) {
            await this.variants.softDelete(ctx, variant.id);
        }
        for (const [index, variant] of form.variants.entries()) {
            const name = (language: 'bn' | 'en') => {
                const base = form.name[language] || form.name.bn || form.name.en;
                const option = variant.option[language] || variant.option.bn || variant.option.en;
                return option ? `${base} - ${option}` : base;
            };
            const common = {
                sku: variant.sku || `P${productId}-${index + 1}`,
                price: variant.price,
                enabled: variant.enabled,
                featuredAssetId: variant.assetId ?? undefined,
                assetIds: variant.assetId ? [variant.assetId] : [],
                useGlobalOutOfStockThreshold: !variant.allowBackorder,
                outOfStockThreshold: variant.allowBackorder ? BACKORDER_THRESHOLD : 0,
                translations: (['bn', 'en'] as const)
                    .filter(language => form.name[language] || language === 'bn')
                    .map(language => ({ languageCode: LanguageCode[language], name: name(language) })),
                customFields: {
                    oldPrice: variant.oldPrice,
                    isDefault: variant.isDefault,
                    weightGrams: variant.weightGrams,
                },
            };
            if (variant.id) {
                const { stockOnHand } = await this.stockLevels.getAvailableStock(ctx, variant.id);
                await this.variants.update(ctx, [{ id: variant.id, ...common }]);
                if (stockOnHand !== variant.stock) {
                    await this.stock.adjust(ctx, {
                        variantId: variant.id,
                        change: variant.stock - stockOnHand,
                        reason: 'recount',
                    });
                }
            } else {
                const optionId = optionIds[index];
                await this.variants.create(ctx, [
                    {
                        productId,
                        ...common,
                        optionIds: optionId ? [optionId] : [],
                        stockOnHand: variant.stock,
                    },
                ]);
            }
        }
    }
}

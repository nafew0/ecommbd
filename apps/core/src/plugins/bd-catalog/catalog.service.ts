import { cleanText, slugify } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Collection,
    CollectionService,
    type ID,
    LanguageCode,
    Product,
    ProductVariant,
    RequestContext,
    StockLevelService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';
import { ShippingSettingsService } from '../shipping-bd';
import { CATEGORY_FILTER_CODE } from './category-filter';
import { channelPrice } from './product-form.service';

export interface CategoryInput {
    id?: string | null;
    name: { bn: string; en: string };
    assetId?: string | null;
    parentId?: string | null;
    /** Products in this category deliver free (phase 07's free-delivery collections). */
    freeDelivery?: boolean | null;
}

const NAME_LIMIT = 100;

/** The product list and categories of the merchant admin (phase 05). */
@Injectable()
export class CatalogService {
    constructor(
        private connection: TransactionalConnection,
        private collections: CollectionService,
        private stockLevels: StockLevelService,
        private shippingSettings: ShippingSettingsService,
    ) {}

    /** Products for the list: image, name, category, price (and old price), stock, badges. */
    async products(
        ctx: RequestContext,
        options: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        const qb = this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .leftJoinAndSelect('product.translations', 'translation')
            .leftJoinAndSelect('product.featuredAsset', 'asset')
            .leftJoinAndSelect('product.customFields.category', 'category')
            .leftJoinAndSelect('category.translations', 'categoryTranslation')
            .where('product.deletedAt IS NULL');
        const search = cleanText(options.search ?? '');
        if (search) {
            qb.andWhere(
                `product.id IN (SELECT t."baseId" FROM "product_translation" t WHERE t."name" ILIKE :search
                 UNION SELECT v."productId" FROM "product_variant" v WHERE v."sku" ILIKE :search AND v."deletedAt" IS NULL)`,
                { search: `%${search}%` },
            );
        }
        const [products, totalItems] = await qb
            .orderBy('product.createdAt', 'DESC')
            .skip(Math.max(options.skip ?? 0, 0))
            .take(Math.min(Math.max(options.take ?? 25, 1), 100))
            .getManyAndCount();
        const variants = products.length
            ? await this.connection.getRepository(ctx, ProductVariant).find({
                  where: { productId: In(products.map(p => p.id)), deletedAt: IsNull() },
                  relations: { productVariantPrices: true },
              })
            : [];
        const items = await Promise.all(
            products.map(async product => {
                const own = variants.filter(variant => variant.productId === product.id);
                const levels = await Promise.all(own.map(v => this.stockLevels.getAvailableStock(ctx, v.id)));
                const cheapest = [...own].sort((a, b) => channelPrice(ctx, a) - channelPrice(ctx, b))[0];
                const name = (language: string) =>
                    product.translations.find(t => t.languageCode === language)?.name;
                const category = product.customFields.category as Collection | null | undefined;
                return {
                    id: product.id,
                    name: name(ctx.languageCode) ?? name('bn') ?? name('en') ?? '',
                    banglaMissing: !name('bn'),
                    preview: product.featuredAsset?.preview ?? null,
                    categoryName:
                        category?.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                        category?.translations[0]?.name ??
                        null,
                    price: cheapest ? channelPrice(ctx, cheapest) : 0,
                    oldPrice: cheapest?.customFields.oldPrice ?? null,
                    stock: levels.reduce((sum, level) => sum + level.stockOnHand - level.stockAllocated, 0),
                    variantCount: own.length,
                    featured: product.customFields.featured ?? false,
                    isNew: product.customFields.isNew ?? false,
                    enabled: product.enabled,
                };
            }),
        );
        return { items, totalItems };
    }

    async categories(ctx: RequestContext) {
        const rows = await this.connection.getRepository(ctx, Collection).find({
            where: { customFields: { bdCategory: true } },
            relations: { translations: true, featuredAsset: true, parent: true },
            order: { position: 'ASC' },
        });
        const { freeCollectionIds } = await this.shippingSettings.get(ctx);
        const counts: Array<{ id: string; count: string }> = await this.connection
            .getRepository(ctx, Product)
            .query(
                `SELECT "customFieldsCategoryid"::text AS id, COUNT(*)::text AS count FROM "product"
             WHERE "deletedAt" IS NULL AND "customFieldsCategoryid" IS NOT NULL GROUP BY 1`,
            );
        const name = (row: Collection, language: string) =>
            row.translations.find(t => t.languageCode === language)?.name ?? '';
        return rows.map(row => ({
            id: row.id,
            name: { bn: name(row, 'bn'), en: name(row, 'en') },
            preview: row.featuredAsset?.preview ?? null,
            assetId: row.featuredAsset?.id ?? null,
            parentId: row.parent && row.parent.customFields.bdCategory ? row.parent.id : null,
            position: row.position,
            productCount: Number(counts.find(count => count.id === String(row.id))?.count ?? 0),
            freeDelivery: freeCollectionIds.includes(String(row.id)),
        }));
    }

    /** Creates or updates a category: names in both languages, image, parent, free delivery. */
    async saveCategory(ctx: RequestContext, input: CategoryInput) {
        const name = {
            bn: cleanText(input.name.bn).slice(0, NAME_LIMIT),
            en: cleanText(input.name.en).slice(0, NAME_LIMIT),
        };
        if (!name.bn && !name.en) {
            throw new UserInputError('message.bd-catalog.category-name');
        }
        if (input.parentId && input.parentId === input.id) {
            throw new UserInputError('message.bd-catalog.category-parent');
        }
        const slug = slugify(name.en) || `c-${Date.now().toString(36)}`;
        const translations = (['bn', 'en'] as const)
            .filter(language => name[language])
            .map(language => ({
                languageCode: LanguageCode[language],
                name: name[language],
                slug,
                description: '',
            }));
        const saved = await this.connection.withTransaction(ctx, async txCtx => {
            let collection: Collection;
            if (input.id) {
                const existing = await this.connection
                    .getRepository(txCtx, Collection)
                    .findOne({ where: { id: input.id } });
                if (!existing?.customFields.bdCategory)
                    throw new UserInputError('message.bd-catalog.category-missing');
                collection = await this.collections.update(txCtx, {
                    id: input.id,
                    translations,
                    featuredAssetId: input.assetId ?? undefined,
                    assetIds: input.assetId ? [input.assetId] : [],
                    parentId: input.parentId ?? undefined,
                });
            } else {
                collection = await this.collections.create(txCtx, {
                    translations,
                    featuredAssetId: input.assetId ?? undefined,
                    assetIds: input.assetId ? [input.assetId] : [],
                    parentId: input.parentId ?? undefined,
                    inheritFilters: false,
                    filters: [],
                    customFields: { bdCategory: true },
                } as never);
                // The filter needs the collection's own ID, so it's set once the collection exists.
                collection = await this.collections.update(txCtx, {
                    id: collection.id,
                    filters: [
                        {
                            code: CATEGORY_FILTER_CODE,
                            arguments: [{ name: 'collectionId', value: String(collection.id) }],
                        },
                    ],
                });
            }
            return collection;
        });
        if (input.freeDelivery != null) {
            await this.setFreeDelivery(ctx, String(saved.id), input.freeDelivery);
        }
        return saved;
    }

    async moveCategory(ctx: RequestContext, input: { id: ID; index: number; parentId?: ID | null }) {
        const collection = await this.connection.getRepository(ctx, Collection).findOne({
            where: { id: input.id },
            relations: { parent: true },
        });
        if (!collection?.customFields.bdCategory)
            throw new UserInputError('message.bd-catalog.category-missing');
        return this.collections.move(ctx, {
            collectionId: input.id,
            parentId: input.parentId ?? collection.parent!.id,
            index: Math.max(0, input.index),
        });
    }

    async deleteCategory(ctx: RequestContext, id: ID) {
        const collection = await this.connection.getRepository(ctx, Collection).findOne({ where: { id } });
        if (!collection?.customFields.bdCategory)
            throw new UserInputError('message.bd-catalog.category-missing');
        await this.connection
            .getRepository(ctx, Product)
            .query(
                'UPDATE "product" SET "customFieldsCategoryid" = NULL WHERE "customFieldsCategoryid" = $1',
                [id],
            );
        await this.setFreeDelivery(ctx, String(id), false);
        return this.collections.delete(ctx, id);
    }

    private async setFreeDelivery(ctx: RequestContext, id: string, free: boolean) {
        const settings = await this.shippingSettings.get(ctx);
        const has = settings.freeCollectionIds.includes(id);
        if (has === free) return;
        await this.shippingSettings.setFreeCollections(
            ctx,
            free
                ? [...settings.freeCollectionIds, id]
                : settings.freeCollectionIds.filter(other => other !== id),
        );
    }
}

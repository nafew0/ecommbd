import { cleanText, STOCK_REASONS, type StockReason } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    type ID,
    ProductVariant,
    RequestContext,
    StockLevelService,
    StockLocationService,
    StockMovementService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { assetUrl } from './asset-url';
import { channelPrice } from './product-form.service';
import { BdStockAdjustment } from './stock-adjustment.entity';

/** Variants at or below this many units are highlighted in the stock list (alerts come in phase 35). */
export const LOW_STOCK_AT = 5;

/** Stock adjustments with a reason (phase 05), and the stock list. */
@Injectable()
export class StockService {
    constructor(
        private connection: TransactionalConnection,
        private stockLevels: StockLevelService,
        private locations: StockLocationService,
        private movements: StockMovementService,
        private config: ConfigService,
    ) {}

    /**
     * Adds or removes units at one location, recording why. With no location, that is the
     * store's original one (Vendure's default). Stock never goes below zero this way.
     * `keepPromised` also refuses to take units already reserved for an order.
     */
    async adjust(
        ctx: RequestContext,
        input: {
            variantId: ID;
            change: number;
            reason: string;
            note?: string | null;
            stockLocationId?: ID | null;
            keepPromised?: boolean;
        },
    ): Promise<BdStockAdjustment> {
        if (!(STOCK_REASONS as readonly string[]).includes(input.reason)) {
            throw new UserInputError('message.bd-catalog.stock-reason');
        }
        if (!Number.isSafeInteger(input.change) || input.change === 0) {
            throw new UserInputError('message.bd-catalog.stock-change');
        }
        const note = cleanText(input.note ?? '').slice(0, 500);
        return this.connection.withTransaction(ctx, async txCtx => {
            const location = input.stockLocationId
                ? await this.locations.findOne(txCtx, input.stockLocationId)
                : await this.locations.defaultStockLocation(txCtx);
            if (!location) throw new UserInputError('message.bd-catalog.stock-missing');
            const variant = await this.connection.getRepository(txCtx, ProductVariant).findOne({
                where: { id: input.variantId },
                withDeleted: true,
            });
            if (!variant) throw new UserInputError('message.bd-catalog.stock-missing');
            const locked = await this.stockLevels.getLockedStockLevelsForVariant(txCtx, input.variantId);
            const row = locked.find(level => String(level.stockLocationId) === String(location.id));
            const onHand = row?.stockOnHand ?? 0;
            const allocated = row?.stockAllocated ?? 0;
            const after = onHand + input.change;
            if (after < 0) throw new UserInputError('message.bd-catalog.stock-negative');
            if (input.keepPromised && after < allocated) {
                throw new UserInputError('message.bd-catalog.stock-promised');
            }
            await this.movements.adjustProductVariantStock(txCtx, input.variantId, [
                { stockLocationId: location.id, stockOnHand: after },
            ]);
            return this.connection.getRepository(txCtx, BdStockAdjustment).save(
                new BdStockAdjustment({
                    productVariantId: input.variantId,
                    change: input.change,
                    stockAfter: after,
                    reason: input.reason as StockReason,
                    note,
                    staffName: await this.staffName(txCtx),
                }),
            );
        });
    }

    /** On-hand at the original location: what the product form shows and saves. */
    async onHand(ctx: RequestContext, variantId: ID, locationId?: ID | null): Promise<number> {
        const id = locationId ?? (await this.locations.defaultStockLocation(ctx)).id;
        return (await this.levelAt(ctx, variantId, id)).stockOnHand;
    }

    /** On-hand across every location of this channel. Cost averaging uses this, not one branch. */
    async totalOnHand(ctx: RequestContext, variantId: ID): Promise<number> {
        const { stockOnHand } = await this.stockLevels.getAvailableStock(ctx, variantId);
        return stockOnHand;
    }

    async levelAt(
        ctx: RequestContext,
        variantId: ID,
        locationId: ID,
    ): Promise<{ stockOnHand: number; stockAllocated: number }> {
        const rows = (await this.connection.getRepository(ctx, ProductVariant).query(
            `SELECT "stockOnHand", "stockAllocated" FROM stock_level
             WHERE "productVariantId" = $1 AND "stockLocationId" = $2`,
            [variantId, locationId],
        )) as Array<{ stockOnHand: number | string; stockAllocated: number | string }>;
        const row = rows[0];
        return {
            stockOnHand: Number(row?.stockOnHand ?? 0),
            stockAllocated: Number(row?.stockAllocated ?? 0),
        };
    }

    history(ctx: RequestContext, variantId: ID) {
        return this.connection.getRepository(ctx, BdStockAdjustment).find({
            where: { productVariantId: variantId },
            order: { createdAt: 'DESC' },
            take: 50,
        });
    }

    /** Every variant with its stock, lowest first; `search` matches the name or SKU. */
    async list(
        ctx: RequestContext,
        options: {
            search?: string | null;
            lowOnly?: boolean | null;
            take?: number | null;
            includeArchived?: boolean | null;
            branchId?: ID | null;
        },
    ) {
        const qb = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .leftJoinAndSelect('variant.translations', 'translation')
            .leftJoinAndSelect('variant.product', 'product')
            .leftJoinAndSelect('product.featuredAsset', 'asset')
            .leftJoinAndSelect('variant.productVariantPrices', 'price');
        if (options.includeArchived) qb.withDeleted();
        else qb.where('variant.deletedAt IS NULL').andWhere('product.deletedAt IS NULL');
        const search = cleanText(options.search ?? '');
        if (search) {
            qb.andWhere('(translation.name ILIKE :search OR variant.sku ILIKE :search)', {
                search: `%${search}%`,
            });
        }
        const variants = await qb.orderBy('variant.id', 'ASC').take(500).getMany();
        const rows = await Promise.all(
            variants.map(async variant => {
                const { stockOnHand, stockAllocated } = options.branchId
                    ? await this.levelAt(ctx, variant.id, options.branchId)
                    : await this.stockLevels.getAvailableStock(ctx, variant.id);
                const name =
                    variant.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                    variant.translations[0]?.name ??
                    variant.sku;
                const backorder = !variant.useGlobalOutOfStockThreshold && variant.outOfStockThreshold < 0;
                return {
                    variantId: variant.id,
                    productId: variant.productId,
                    name,
                    sku: variant.sku,
                    preview: assetUrl(this.config, ctx, variant.product.featuredAsset?.preview),
                    stockOnHand,
                    allocated: stockAllocated,
                    available: stockOnHand - stockAllocated,
                    price: channelPrice(ctx, variant),
                    backorder,
                    low: !backorder && stockOnHand - stockAllocated <= LOW_STOCK_AT,
                };
            }),
        );
        const filtered = options.lowOnly ? rows.filter(row => row.low) : rows;
        return filtered
            .sort((a, b) => a.available - b.available)
            .slice(0, Math.min(options.take ?? 100, 500));
    }

    private async staffName(ctx: RequestContext): Promise<string> {
        if (!ctx.activeUserId) return '';
        const [row] = await this.connection
            .getRepository(ctx, ProductVariant)
            .query('SELECT "firstName", "lastName" FROM "administrator" WHERE "userId" = $1', [
                ctx.activeUserId,
            ]);
        return row ? `${row.firstName} ${row.lastName}`.trim() : '';
    }
}

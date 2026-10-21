import { cleanText, STOCK_REASONS, type StockReason } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type ID,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { channelPrice } from './product-form.service';
import { BdStockAdjustment } from './stock-adjustment.entity';

/** Variants at or below this many units are highlighted in the stock list (alerts come in phase 35). */
export const LOW_STOCK_AT = 5;

/** Stock adjustments with a reason (phase 05), and the stock list. */
@Injectable()
export class StockService {
    constructor(
        private connection: TransactionalConnection,
        private variants: ProductVariantService,
        private stockLevels: StockLevelService,
    ) {}

    /** Adds or removes units, recording why. Stock never goes below zero this way. */
    async adjust(
        ctx: RequestContext,
        input: { variantId: ID; change: number; reason: string; note?: string | null },
    ): Promise<BdStockAdjustment> {
        if (!(STOCK_REASONS as readonly string[]).includes(input.reason)) {
            throw new UserInputError('message.bd-catalog.stock-reason');
        }
        if (!Number.isSafeInteger(input.change) || input.change === 0) {
            throw new UserInputError('message.bd-catalog.stock-change');
        }
        const note = cleanText(input.note ?? '').slice(0, 500);
        return this.connection.withTransaction(ctx, async txCtx => {
            const { stockOnHand } = await this.stockLevels.getAvailableStock(txCtx, input.variantId, {
                lockStockLevels: true,
            });
            const after = stockOnHand + input.change;
            if (after < 0) {
                throw new UserInputError('message.bd-catalog.stock-negative');
            }
            await this.variants.update(txCtx, [{ id: input.variantId, stockOnHand: after }]);
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
        options: { search?: string | null; lowOnly?: boolean | null; take?: number | null },
    ) {
        const qb = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .leftJoinAndSelect('variant.translations', 'translation')
            .leftJoinAndSelect('variant.product', 'product')
            .leftJoinAndSelect('product.featuredAsset', 'asset')
            .leftJoinAndSelect('variant.productVariantPrices', 'price')
            .where('variant.deletedAt IS NULL')
            .andWhere('product.deletedAt IS NULL');
        const search = cleanText(options.search ?? '');
        if (search) {
            qb.andWhere('(translation.name ILIKE :search OR variant.sku ILIKE :search)', {
                search: `%${search}%`,
            });
        }
        const variants = await qb.orderBy('variant.id', 'ASC').take(500).getMany();
        const rows = await Promise.all(
            variants.map(async variant => {
                const { stockOnHand, stockAllocated } = await this.stockLevels.getAvailableStock(
                    ctx,
                    variant.id,
                );
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
                    preview: variant.product.featuredAsset?.preview ?? null,
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

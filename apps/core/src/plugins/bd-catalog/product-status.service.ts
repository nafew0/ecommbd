import { TRASH_DAYS } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type ID,
    Logger,
    Product,
    ProductService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { IsNull, LessThan, Not } from 'typeorm';

const loggerCtx = 'BdCatalogPlugin';

/**
 * The product trash (phase 55). Moving a product to the trash takes it off the storefront and out
 * of the list; it can be restored for `TRASH_DAYS` days, as a draft. After that, or when the shop
 * deletes it for good, Vendure deletes it (its own soft delete), as the old Delete button did.
 */
@Injectable()
export class ProductStatusService {
    constructor(
        private connection: TransactionalConnection,
        private products: ProductService,
    ) {}

    async trash(ctx: RequestContext, id: ID): Promise<boolean> {
        const product = await this.find(ctx, id);
        if (product.customFields.trashedAt) return true;
        await this.products.update(ctx, { id: product.id, enabled: false, customFields: { trashedAt: new Date() } });
        return true;
    }

    /** Comes back as a draft, so nothing goes on sale by surprise. */
    async restore(ctx: RequestContext, id: ID): Promise<boolean> {
        const product = await this.find(ctx, id);
        if (!product.customFields.trashedAt) return true;
        await this.products.update(ctx, {
            id: product.id,
            enabled: false,
            customFields: { trashedAt: null, status: 'draft' },
        });
        return true;
    }

    async deleteForever(ctx: RequestContext, id: ID): Promise<boolean> {
        const product = await this.find(ctx, id);
        if (!product.customFields.trashedAt) throw new UserInputError('message.bd-catalog.not-in-trash');
        await this.products.softDelete(ctx, product.id);
        return true;
    }

    /** Deletes products that have been in the trash longer than `TRASH_DAYS`. Returns how many. */
    async emptyOld(ctx: RequestContext, now = new Date()): Promise<number> {
        const cutoff = new Date(now.getTime() - TRASH_DAYS * 24 * 60 * 60 * 1000);
        const old = await this.connection.getRepository(ctx, Product).find({
            where: { deletedAt: IsNull(), customFields: { trashedAt: LessThan(cutoff) } },
            select: { id: true },
        });
        for (const product of old) {
            try {
                await this.products.softDelete(ctx, product.id);
            } catch (error) {
                Logger.error(
                    `Could not empty product ${String(product.id)} from the trash: ${
                        error instanceof Error ? error.message : 'failed'
                    }`,
                    loggerCtx,
                );
            }
        }
        return old.length;
    }

    /** Whether a product is in the trash (the form refuses to load or save one). */
    async isTrashed(ctx: RequestContext, id: ID): Promise<boolean> {
        const found = await this.connection.getRepository(ctx, Product).findOne({
            where: { id, deletedAt: IsNull(), customFields: { trashedAt: Not(IsNull()) } },
            select: { id: true },
        });
        return !!found;
    }

    private async find(ctx: RequestContext, id: ID): Promise<Product> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id, deletedAt: IsNull() },
        });
        if (!product) throw new UserInputError('message.bd-catalog.product-missing');
        return product;
    }
}

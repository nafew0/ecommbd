import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { type CategoryInput, CatalogService } from './catalog.service';
import { ProductFormService } from './product-form.service';
import { StockService } from './stock.service';

@Resolver()
export class CatalogAdminResolver {
    constructor(
        private catalog: CatalogService,
        private productForm: ProductFormService,
        private stock: StockService,
    ) {}

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdProducts(@Ctx() ctx: RequestContext, @Args() args: { search?: string; skip?: number; take?: number }) {
        return this.catalog.products(ctx, args);
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdProductForm(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.productForm.load(ctx, args.id);
    }

    @Mutation()
    @Allow(Permission.CreateProduct, Permission.UpdateProduct, Permission.UpdateCatalog)
    saveBdProduct(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.productForm.save(ctx, args.input);
    }

    @Query()
    @Allow(Permission.ReadCollection, Permission.ReadCatalog)
    bdCategories(@Ctx() ctx: RequestContext) {
        return this.catalog.categories(ctx);
    }

    @Mutation()
    @Allow(Permission.CreateCollection, Permission.UpdateCollection, Permission.UpdateCatalog)
    async saveBdCategory(@Ctx() ctx: RequestContext, @Args() args: { input: CategoryInput }) {
        const saved = await this.catalog.saveCategory(ctx, args.input);
        return (await this.catalog.categories(ctx)).find(
            category => String(category.id) === String(saved.id),
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCollection, Permission.UpdateCatalog)
    async moveBdCategory(@Ctx() ctx: RequestContext, @Args() args: { id: ID; index: number }) {
        await this.catalog.moveCategory(ctx, args);
        return (await this.catalog.categories(ctx)).find(category => String(category.id) === String(args.id));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCollection, Permission.DeleteCatalog)
    async deleteBdCategory(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        await this.catalog.deleteCategory(ctx, args.id);
        return true;
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdStock(@Ctx() ctx: RequestContext, @Args() args: { search?: string; lowOnly?: boolean; take?: number }) {
        return this.stock.list(ctx, args);
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdStockHistory(@Ctx() ctx: RequestContext, @Args() args: { variantId: ID }) {
        return this.stock.history(ctx, args.variantId);
    }

    @Mutation()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    adjustBdStock(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { variantId: ID; change: number; reason: string; note?: string | null } },
    ) {
        return this.stock.adjust(ctx, args.input);
    }
}

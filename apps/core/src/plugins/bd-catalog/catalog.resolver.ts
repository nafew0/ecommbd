import { type ProductListStatus, unitName } from '@ecommbd/shared';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Permission, Product, RequestContext, Transaction } from '@vendure/core';
import { type CategoryInput, CatalogService } from './catalog.service';
import { ProductFormService } from './product-form.service';
import { ProductSettingsService } from './product-settings.service';
import { ProductStatusService } from './product-status.service';
import { StockService } from './stock.service';

@Resolver()
export class CatalogAdminResolver {
    constructor(
        private catalog: CatalogService,
        private productForm: ProductFormService,
        private stock: StockService,
        private status: ProductStatusService,
        private productSettings: ProductSettingsService,
    ) {}

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdProducts(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            search?: string;
            skip?: number;
            take?: number;
            costMissing?: boolean | null;
            status?: string | null;
        },
    ) {
        const statuses = ['published', 'draft', 'archived', 'trash'];
        const status = args.status && statuses.includes(args.status) ? (args.status as ProductListStatus) : null;
        return this.catalog.products(ctx, { ...args, status });
    }

    @Query()
    @Allow(Permission.ReadProduct, Permission.ReadCatalog)
    bdProductSettings(@Ctx() ctx: RequestContext) {
        return this.productSettings.get(ctx);
    }

    @Mutation()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    updateBdProductSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.productSettings.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteProduct, Permission.DeleteCatalog)
    trashBdProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.status.trash(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteProduct, Permission.DeleteCatalog)
    restoreBdProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.status.restore(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteProduct, Permission.DeleteCatalog)
    deleteBdProductForever(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.status.deleteForever(ctx, args.id);
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
    bdStock(
        @Ctx() ctx: RequestContext,
        @Args() args: { search?: string; lowOnly?: boolean; take?: number; includeArchived?: boolean },
    ) {
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

/** Shop API: `Product.bdUnit` (phase 55). Public, like the product's price. */
@Resolver('Product')
export class CatalogShopProductResolver {
    constructor(private productSettings: ProductSettingsService) {}

    @ResolveField()
    async bdUnit(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<string | null> {
        const code = product.customFields?.unit;
        if (!code) return null;
        const settings = await this.productSettings.get(ctx);
        return unitName(code, settings, ctx.languageCode === 'en' ? 'en' : 'bn');
    }
}

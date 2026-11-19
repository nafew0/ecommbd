import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { BrandService } from './brand.service';

@Resolver()
export class BrandAdminResolver {
    constructor(private brands: BrandService) {}

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadFacet, Permission.ReadProduct)
    bdBrands(@Ctx() ctx: RequestContext, @Args() args: { search?: string | null }) {
        return this.brands.list(ctx, args.search);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadFacet, Permission.ReadProduct)
    bdBrand(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.brands.one(ctx, args.id);
    }

    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.CreateFacet, Permission.UpdateFacet)
    saveBdBrand(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.brands.save(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteFacet)
    deleteBdBrand(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.brands.delete(ctx, args.id);
    }
}

/** Public: a brand's page and the sitemap. Only names, descriptions and logos. */
@Resolver()
export class BrandShopResolver {
    constructor(private brands: BrandService) {}

    @Query()
    @Allow(Permission.Public)
    bdBrand(@Ctx() ctx: RequestContext, @Args() args: { code: string }) {
        return this.brands.byCode(ctx, args.code);
    }

    @Query()
    @Allow(Permission.Public)
    bdBrands(@Ctx() ctx: RequestContext) {
        return this.brands.onSale(ctx);
    }
}

import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Order, Permission, RequestContext, Transaction } from '@vendure/core';
import { editStorefrontPermission } from '../bd-sections';
import { readSalesFiguresPermission } from '../bd-orders';
import { type SalesPageInput, SalesPageService } from './sales-page.service';

@Resolver()
export class SalesPagesShopResolver {
    constructor(private pages: SalesPageService) {}

    @Query()
    @Allow(Permission.Public)
    bdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { slug: string; preview?: string | null }) {
        return this.pages.shopPage(ctx, args.slug, args.preview);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    setBdSalesPageOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { slug: string; variantId: ID; quantity: number; bump?: boolean | null } },
    ) {
        return this.pages.setOrder(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    setBdOrderAttribution(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.pages.setAttribution(ctx, args.input);
    }
}

@Resolver()
export class SalesPagesAdminResolver {
    constructor(private pages: SalesPageService) {}

    @Query()
    @Allow(editStorefrontPermission.Permission)
    bdSalesPages(
        @Ctx() ctx: RequestContext,
        @Args() args: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        return this.pages.list(ctx, args);
    }

    @Query()
    @Allow(editStorefrontPermission.Permission)
    bdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pages.findOne(ctx, args.id);
    }

    /** Counts need ReadOrder; values also need ReadSalesFigures (null otherwise). */
    @Query()
    @Allow(Permission.ReadOrder)
    bdOrdersByCampaign(
        @Ctx() ctx: RequestContext,
        @Args() args: { dateFrom?: string | null; dateTo?: string | null },
    ) {
        return this.pages.campaigns(
            ctx,
            args,
            ctx.userHasPermissions([readSalesFiguresPermission.Permission]),
        );
    }

    @Mutation()
    @Transaction()
    @Allow(editStorefrontPermission.Permission)
    createBdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { input: SalesPageInput }) {
        return this.pages.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(editStorefrontPermission.Permission)
    updateBdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: SalesPageInput }) {
        return this.pages.update(ctx, args.id, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(editStorefrontPermission.Permission)
    duplicateBdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pages.duplicate(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(editStorefrontPermission.Permission)
    deleteBdSalesPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pages.delete(ctx, args.id);
    }
}

@Resolver('Order')
export class OrderAttributionResolver {
    constructor(private pages: SalesPageService) {}

    @ResolveField()
    @Allow(Permission.ReadOrder)
    async bdAttribution(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const fields = order.customFields as Record<string, string | Date | null | undefined>;
        const text = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string) : null);
        return {
            salesPage: await this.pages.pageOf(ctx, order),
            source: text('utmSource'),
            medium: text('utmMedium'),
            campaign: text('utmCampaign'),
            content: text('utmContent'),
            term: text('utmTerm'),
            fbclid: text('fbclid'),
            gclid: text('gclid'),
            ttclid: text('ttclid'),
            referrer: text('referrer'),
            at: fields.attributedAt ?? null,
        };
    }
}

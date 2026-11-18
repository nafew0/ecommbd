import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ForbiddenError, type ID, RequestContext } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { readCostPermission } from '../bd-cost';
import { managePurchasePermission, readPurchasePermission } from './constants';
import { PurchaseService } from './purchase.service';
import { PurchaseSettingsService } from './purchase-settings.service';

/** Purchases carry unit cost. @Allow is OR, so ReadCost is checked again inside each method. */
@Resolver()
export class PurchaseAdminResolver {
    constructor(
        private purchases: PurchaseService,
        private settings: PurchaseSettingsService,
    ) {}

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdSuppliers(
        @Ctx() ctx: RequestContext,
        @Args() args: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        this.seeCost(ctx);
        return this.purchases.suppliers(ctx, args);
    }

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdSupplier(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        this.seeCost(ctx);
        return this.purchases.supplier(ctx, args.id);
    }

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdPurchases(
        @Ctx() ctx: RequestContext,
        @Args()
        args: { search?: string | null; status?: string | null; supplierId?: ID | null; skip?: number | null; take?: number | null },
    ) {
        this.seeCost(ctx);
        return this.purchases.purchases(ctx, args);
    }

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdPurchase(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        this.seeCost(ctx);
        return this.purchases.purchase(ctx, args.id);
    }

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdPurchaseSettings(@Ctx() ctx: RequestContext) {
        this.seeCost(ctx);
        return this.settings.get(ctx);
    }

    @Query()
    @Allow(readPurchasePermission.Permission)
    bdPurchasePrint(@Ctx() ctx: RequestContext, @Args() args: { id: ID; document: string }) {
        this.seeCost(ctx);
        return this.purchases.print(ctx, args.id, args.document);
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    async createBdSupplier(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        this.seeCost(ctx);
        const saved = await this.purchases.saveSupplier(ctx, null, args.input);
        return { supplier: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    async updateBdSupplier(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: unknown }) {
        this.seeCost(ctx);
        const saved = await this.purchases.saveSupplier(ctx, args.id, args.input);
        return { supplier: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    async createBdPurchase(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        this.seeCost(ctx);
        const saved = await this.purchases.savePurchase(ctx, null, args.input);
        return { purchase: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    async updateBdPurchase(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: unknown }) {
        this.seeCost(ctx);
        const saved = await this.purchases.savePurchase(ctx, args.id, args.input);
        return { purchase: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    deleteBdPurchase(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        this.seeCost(ctx);
        return this.purchases.remove(ctx, args.id);
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    markBdPurchaseOrdered(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        this.seeCost(ctx);
        return this.purchases.markOrdered(ctx, args.id);
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    receiveBdPurchase(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: unknown }) {
        this.seeCost(ctx);
        return this.purchases.receive(ctx, args.id, args.input);
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    returnBdPurchase(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: unknown }) {
        this.seeCost(ctx);
        return this.purchases.returnGoods(ctx, args.id, args.input);
    }

    @Mutation()
    @Allow(managePurchasePermission.Permission)
    recordBdSupplierPayment(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        this.seeCost(ctx);
        return this.purchases.pay(ctx, args.input);
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdPurchaseSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        if (!ctx.userHasPermissions([readPurchasePermission.Permission])) throw new ForbiddenError();
        this.seeCost(ctx);
        return this.settings.update(ctx, args.input);
    }

    private seeCost(ctx: RequestContext) {
        if (!ctx.userHasPermissions([readCostPermission.Permission])) throw new ForbiddenError();
    }
}

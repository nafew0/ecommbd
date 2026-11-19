import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, RequestContext } from '@vendure/core';
import { BranchService } from './branch.service';
import { BranchSettingsService } from './branch-settings.service';
import { manageBranchPermission, readBranchPermission } from './constants';
import { TransferService } from './transfer.service';

/** Branches and transfers. @Allow is on each method: a class-level decorator is ignored. */
@Resolver()
export class BranchAdminResolver {
    constructor(
        private branches: BranchService,
        private settings: BranchSettingsService,
        private transfers: TransferService,
    ) {}

    @Query()
    @Allow(readBranchPermission.Permission)
    bdBranches(@Ctx() ctx: RequestContext) {
        return this.branches.list(ctx);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdBranch(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.branches.one(ctx, args.id);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdBranchUsage(@Ctx() ctx: RequestContext) {
        return this.branches.usage(ctx);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdBranchSettings(@Ctx() ctx: RequestContext) {
        return this.settings.getPublic(ctx);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdTransfers(@Ctx() ctx: RequestContext) {
        return this.transfers.list(ctx);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdTransfer(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.transfers.one(ctx, args.id);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdOrderBranch(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.branches.orderBranch(ctx, args.orderId);
    }

    @Query()
    @Allow(readBranchPermission.Permission)
    bdProductBranchStock(@Ctx() ctx: RequestContext, @Args() args: { productId: ID }) {
        return this.branches.productBranchStock(ctx, args.productId);
    }

    @Mutation()
    @Allow(manageBranchPermission.Permission)
    async saveBdBranch(@Ctx() ctx: RequestContext, @Args() args: { id?: ID | null; input: unknown }) {
        const saved = await this.branches.save(ctx, args.id ?? null, args.input);
        return { branch: saved.branch, errors: saved.errors };
    }

    @Mutation()
    @Allow(manageBranchPermission.Permission)
    deleteBdBranch(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.branches.remove(ctx, args.id);
    }

    @Mutation()
    @Allow(manageBranchPermission.Permission)
    async updateBdBranchSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        const saved = await this.settings.update(ctx, args.input);
        return saved.ok ? { settings: saved.settings, errors: [] } : { settings: null, errors: saved.errors };
    }

    @Mutation()
    @Allow(manageBranchPermission.Permission)
    sendBdTransfer(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.transfers.send(ctx, args.input);
    }

    @Mutation()
    @Allow(manageBranchPermission.Permission)
    receiveBdTransfer(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: unknown }) {
        return this.transfers.receive(ctx, args.id, args.input);
    }
}

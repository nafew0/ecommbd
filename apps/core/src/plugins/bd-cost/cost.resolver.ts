import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ForbiddenError, type ID, RequestContext } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { readCostPermission } from './constants';
import { CostService } from './cost.service';
import { CostSettingsService } from './cost-settings.service';

@Resolver()
export class CostAdminResolver {
    constructor(
        private cost: CostService,
        private settings: CostSettingsService,
    ) {}

    @Query()
    @Allow(readCostPermission.Permission)
    bdOrderProfit(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.cost.profit(ctx, args.orderId);
    }

    @Query()
    @Allow(readCostPermission.Permission)
    bdOrderProfits(@Ctx() ctx: RequestContext, @Args() args: { orderIds: ID[] }) {
        return this.cost.profits(ctx, args.orderIds ?? []);
    }

    @Query()
    @Allow(readCostPermission.Permission)
    bdCostSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    /**
     * @Allow is OR, so UpdateStoreSettings alone is not enough: a role that can edit settings
     * but cannot see cost is refused here.
     */
    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdCostSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        if (!ctx.userHasPermissions([readCostPermission.Permission])) throw new ForbiddenError();
        return this.settings.update(ctx, args.input);
    }
}

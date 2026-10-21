import { DISMISS_REASONS, type DismissReason, type IncompleteStatus } from '@ecommbd/shared';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    Customer,
    type ID,
    Order,
    Permission,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { type BlockInput, BlockListService } from './block-list.service';
import { readRiskPermission } from './constants';
import type { BdIncompleteCheckout, BlockKind } from './entities';
import { FraudSettingsService } from './fraud-settings.service';
import { type CheckoutProgressInput, IncompleteCheckoutService, orderNumberOf } from './incomplete-checkout.service';
import { OtpService } from './otp.service';
import { RiskService } from './risk.service';

@Resolver()
export class FraudShopResolver {
    constructor(
        private incomplete: IncompleteCheckoutService,
        private otp: OtpService,
    ) {}

    // Owner: the shopper's own session, so the cart can be read (anonymous shoppers have one too).
    @Mutation()
    @Allow(Permission.Owner)
    saveCheckoutProgress(@Ctx() ctx: RequestContext, @Args() args: { input: CheckoutProgressInput }) {
        return this.incomplete.save(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Owner)
    sendBdOtp(@Ctx() ctx: RequestContext) {
        return this.otp.send(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Owner)
    verifyBdOtp(@Ctx() ctx: RequestContext, @Args() args: { code: string }) {
        return this.otp.verify(ctx, args.code);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Owner)
    skipBdOtp(@Ctx() ctx: RequestContext) {
        return this.otp.skip(ctx);
    }
}

@Resolver()
export class FraudAdminResolver {
    constructor(
        private incomplete: IncompleteCheckoutService,
        private blockList: BlockListService,
        private settings: FraudSettingsService,
    ) {}

    @Query()
    @Allow(Permission.ReadOrder)
    bdIncompleteCheckouts(
        @Ctx() ctx: RequestContext,
        @Args() args: { status?: IncompleteStatus | null; search?: string | null; skip?: number; take?: number },
    ) {
        return this.incomplete.list(ctx, args);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdIncompleteCheckout(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.incomplete.findOne(ctx, args.id);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdIncompleteCheckoutCounts(@Ctx() ctx: RequestContext) {
        return this.incomplete.counts(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    dismissBdIncompleteCheckout(@Ctx() ctx: RequestContext, @Args() args: { id: ID; reason: string }) {
        const reason = (DISMISS_REASONS as readonly string[]).includes(args.reason)
            ? (args.reason as DismissReason)
            : 'other';
        return this.incomplete.dismiss(ctx, args.id, reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    sendBdIncompleteCheckoutSms(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.incomplete.sendSms(ctx, args.id);
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    bdBlockList(
        @Ctx() ctx: RequestContext,
        @Args() args: { kind?: BlockKind | null; search?: string | null; skip?: number; take?: number },
    ) {
        return this.blockList.list(ctx, args);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCustomer)
    async blockBdContact(@Ctx() ctx: RequestContext, @Args() args: { input: BlockInput }) {
        if (args.input.kind !== 'phone' && args.input.kind !== 'ip') return { entry: null, error: 'INVALID_PHONE' };
        const result = await this.blockList.block(ctx, args.input);
        return 'error' in result ? { entry: null, error: result.error } : { entry: result, error: null };
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCustomer)
    unblockBdContact(@Ctx() ctx: RequestContext, @Args() args: { id: ID; reason: string }) {
        return this.blockList.unblock(ctx, args.id, args.reason);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdFraudSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdFraudSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }
}

@Resolver('BdIncompleteCheckout')
export class IncompleteCheckoutFieldResolver {
    constructor(private connection: TransactionalConnection) {}

    @ResolveField()
    orderNumber(@Ctx() ctx: RequestContext, @Parent() record: BdIncompleteCheckout) {
        return orderNumberOf(this.connection, ctx, record.orderId);
    }
}

@Resolver('Order')
export class OrderRiskResolver {
    constructor(private risk: RiskService) {}

    /** Only for staff with ReadRisk: the reasons say things about the customer. */
    @ResolveField()
    @Allow(Permission.ReadOrder)
    bdRisk(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return ctx.userHasPermissions([readRiskPermission.Permission as Permission]) ? this.risk.stored(order) : null;
    }

    @ResolveField()
    @Allow(Permission.ReadOrder)
    bdOtpStatus(@Parent() order: Order) {
        return order.customFields?.otpStatus ?? null;
    }
}

@Resolver('Customer')
export class CustomerBlockResolver {
    constructor(private blockList: BlockListService) {}

    @ResolveField()
    @Allow(Permission.ReadCustomer)
    bdBlock(@Ctx() ctx: RequestContext, @Parent() customer: Customer) {
        return this.blockList.find(ctx, 'phone', customer.customFields?.phone);
    }
}

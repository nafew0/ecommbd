import { bdPaymentType, bdStatusOf, shouldSuggestCancel } from '@ecommbd/shared';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    type ID,
    isGraphQlErrorResult,
    type Order,
    OrderService,
    Permission,
    RequestContext,
} from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import {
    cancelOrderPermission,
    confirmOrderPermission,
    packOrderPermission,
    readSalesFiguresPermission,
} from './constants';
import {
    type CallAttemptInput,
    OrderActionsService,
    type OrderActionInput,
    settledAmount,
} from './order-actions.service';
import { type OrderListFilters, OrderListService, type Page } from './order-list.service';
import { OrderSettingsService } from './order-settings.service';

@Resolver()
export class OrdersAdminResolver {
    constructor(
        private lists: OrderListService,
        private actions: OrderActionsService,
        private settings: OrderSettingsService,
    ) {}

    @Query()
    @Allow(Permission.ReadOrder)
    bdOrders(@Ctx() ctx: RequestContext, @Args() args: OrderListFilters & Page) {
        return this.lists.list(ctx, args, args);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdOrderCounts(@Ctx() ctx: RequestContext, @Args() args: OrderListFilters) {
        return this.lists.counts(ctx, args);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdConfirmationQueue(@Ctx() ctx: RequestContext, @Args() args: Page & { snoozed?: boolean | null }) {
        return this.lists.queue(ctx, args);
    }

    /** Counts need ReadOrder; the sales total also needs ReadSalesFigures (null otherwise). */
    @Query()
    @Allow(Permission.ReadOrder)
    bdOrderStats(@Ctx() ctx: RequestContext, @Args() args: { date?: string | null }) {
        return this.lists.stats(
            ctx,
            args.date,
            ctx.userHasPermissions([readSalesFiguresPermission.Permission]),
        );
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdOrderSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(confirmOrderPermission.Permission)
    confirmBdOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: OrderActionInput & { ignoreStockWarning?: boolean | null } },
    ) {
        return this.actions.confirm(ctx, args.input);
    }

    @Mutation()
    @Allow(confirmOrderPermission.Permission)
    confirmBdOrders(@Ctx() ctx: RequestContext, @Args() args: { orderIds: ID[] }) {
        return this.actions.confirmMany(ctx, args.orderIds);
    }

    @Mutation()
    @Allow(cancelOrderPermission.Permission)
    cancelBdOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: OrderActionInput & { reason: string; note?: string | null } },
    ) {
        return this.actions.cancel(ctx, args.input);
    }

    @Mutation()
    @Allow(packOrderPermission.Permission)
    packBdOrder(@Ctx() ctx: RequestContext, @Args() args: { input: OrderActionInput }) {
        return this.actions.pack(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    markBdOrderShipped(@Ctx() ctx: RequestContext, @Args() args: { input: OrderActionInput }) {
        return this.actions.markShipped(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    markBdOrderDelivered(@Ctx() ctx: RequestContext, @Args() args: { input: OrderActionInput }) {
        return this.actions.markDelivered(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    markBdOrderReturned(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: OrderActionInput & { note?: string | null } },
    ) {
        return this.actions.markReturned(ctx, args.input);
    }

    @Mutation()
    @Allow(confirmOrderPermission.Permission)
    recordBdCallAttempt(@Ctx() ctx: RequestContext, @Args() args: { input: CallAttemptInput }) {
        return this.actions.recordCallAttempt(ctx, args.input);
    }

    @Mutation()
    @Allow(confirmOrderPermission.Permission)
    claimBdOrder(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.actions.claim(ctx, args.orderId);
    }

    @Mutation()
    @Allow(confirmOrderPermission.Permission)
    releaseBdOrderClaim(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.actions.releaseClaim(ctx, args.orderId);
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdOrderSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }
}

@Resolver('BdOrderActionResult')
export class BdOrderActionResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return isGraphQlErrorResult(value) ? (value as { __typename: string }).__typename : 'Order';
    }
}

/** `Order.bd` in the Admin API: the BD status, payment type and queue details of an order. */
@Resolver('Order')
export class OrderInfoResolver {
    constructor(
        private orderService: OrderService,
        private settings: OrderSettingsService,
    ) {}

    @ResolveField()
    async bd(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const payments = order.payments ?? (await this.orderService.getOrderPayments(ctx, order.id));
        const paidAmount = settledAmount({ payments });
        // An online payment still at the gateway (phase 18) is expected online, not collected on delivery.
        const pendingOnline = payments
            .filter(payment => payment.state === 'Pending')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const codDue = Math.max(0, order.totalWithTax - paidAmount - pendingOnline);
        const fields = order.customFields;
        const status = bdStatusOf(order.state);
        const { autoCancel } = await this.settings.get(ctx);
        const claimed = fields.claimedUntil && fields.claimedUntil > new Date();
        return {
            status,
            paymentType:
                pendingOnline > 0 && codDue === 0 ? 'prepaid' : bdPaymentType(order.totalWithTax, paidAmount),
            paidAmount,
            codDue,
            cancelReason: fields.cancelReason ?? null,
            cancelNote: fields.cancelNote ?? null,
            callAttempts: fields.callAttempts ?? 0,
            lastCallAt: fields.lastCallAt ?? null,
            queueAt: fields.confirmQueueAt ?? null,
            claim: claimed
                ? {
                      name: fields.claimedByName,
                      until: fields.claimedUntil,
                      mine: fields.claimedByUserId === String(ctx.activeUserId),
                  }
                : null,
            possibleDuplicateOf: fields.possibleDuplicateOf ?? null,
            suggestCancel:
                status === 'new' &&
                !!order.orderPlacedAt &&
                !fields.imported &&
                shouldSuggestCancel(
                    { placedAt: order.orderPlacedAt, failedCalls: fields.callAttempts ?? 0 },
                    autoCancel,
                ),
            imported: fields.imported ?? false,
        };
    }
}

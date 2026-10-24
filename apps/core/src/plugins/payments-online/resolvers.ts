import { GATEWAY_MODES, type GatewayMode, isOnlineGateway, ONLINE_GATEWAYS } from '@ecommbd/shared';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ErrorResult,
    type ID,
    Order,
    OrderService,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';
import { updateStoreSettingsPermission } from '../bd-core';
import type { TrackedOrder } from '../bd-tracking/tracking.service';
import { BdPaymentAttempt } from './attempt.entity';
import { managePaymentsPermission, ONLINE_METHOD_CODES, PAY_ROUTE } from './constants';
import { GatewayService } from './gateway.service';
import {
    OnlinePaymentError,
    OnlinePaymentService,
    type ReviewAction,
    type ReviewError,
} from './online-payment.service';
import { OnlineSettingsService } from './online-settings.service';
import type { OnlinePaymentMetadata } from './types';

export class BdOnlinePaymentError extends ErrorResult {
    readonly __typename = 'BdOnlinePaymentError';
    readonly errorCode = 'BD_ONLINE_PAYMENT_ERROR' as never;
    readonly message: string;
    constructor(
        readonly reason: ReviewError,
        readonly detail?: string,
    ) {
        super();
        this.message = `BD_ONLINE_PAYMENT.${reason}`;
    }
}

const REVIEW_ACTIONS: readonly ReviewAction[] = ['accept', 'refund', 'resolve'];

function gatewayAndMode(gateway: string, mode: string) {
    if (!isOnlineGateway(gateway) || !(GATEWAY_MODES as readonly string[]).includes(mode)) {
        throw new UserInputError('Unknown gateway or mode');
    }
    return { gateway, mode: mode as GatewayMode };
}

@Resolver('BdPaymentOptions')
export class OnlineShopOptionsResolver {
    constructor(
        private gateways: GatewayService,
        private payments: OnlinePaymentService,
    ) {}

    /** Under Vendure's own bdPaymentOptions query, which already requires an active order. */
    @ResolveField()
    async online(@Ctx() ctx: RequestContext) {
        if (!this.payments.publicUrl) return [];
        const options = [];
        for (const gateway of ONLINE_GATEWAYS) {
            const handle = await this.gateways.handle(ctx, gateway);
            if (!handle || this.gateways.paused(gateway, handle.mode)) continue;
            options.push({ gateway, methodCode: ONLINE_METHOD_CODES[gateway], mode: handle.mode });
        }
        return options;
    }
}

@Resolver('BdTrackedOrder')
export class OnlineTrackedOrderResolver {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private settings: OnlineSettingsService,
    ) {}

    /** The tracked order already passed tracking's own checks (number + phone, or the token). */
    @ResolveField()
    async onlinePayment(@Ctx() ctx: RequestContext, @Parent() tracked: TrackedOrder) {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: tracked.orderId },
            select: { id: true, state: true, orderPlacedAt: true },
        });
        if (order?.state !== 'AwaitingPayment' || !order.orderPlacedAt) return null;
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        const pending = payments.find(payment => payment.state === 'Pending');
        if (!pending) return null;
        const metadata = pending.metadata as OnlinePaymentMetadata;
        const latest = await this.connection.getRepository(ctx, BdPaymentAttempt).findOne({
            where: { paymentId: pending.id },
            order: { id: 'DESC' },
        });
        const { expiryMinutes } = await this.settings.get(ctx);
        return {
            gateway: metadata.gateway,
            purpose: metadata.purpose,
            amount: pending.amount,
            expiresAt: new Date(order.orderPlacedAt.getTime() + expiryMinutes * 60_000),
            lastFailure:
                latest && (latest.status === 'failed' || latest.status === 'cancelled')
                    ? (latest.failureCode ?? latest.status)
                    : null,
        };
    }
}

@Resolver()
export class OnlineAdminResolver {
    constructor(
        private connection: TransactionalConnection,
        private settings: OnlineSettingsService,
        private gateways: GatewayService,
        private payments: OnlinePaymentService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    async bdOnlinePaymentSetup(@Ctx() ctx: RequestContext) {
        const settings = await this.settings.get(ctx);
        const publicUrl = this.payments.publicUrl;
        return {
            settings,
            credentials: await this.settings.credentialViews(ctx),
            health: ONLINE_GATEWAYS.map(gateway => ({
                gateway,
                paused: this.gateways.paused(gateway, settings[gateway].mode),
            })),
            keyringConfigured: this.settings.keyringConfigured,
            publicUrlConfigured: !!publicUrl,
            ipnUrl: publicUrl ? `${publicUrl}/${PAY_ROUTE}/sslcommerz/ipn` : null,
        };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async updateBdOnlinePaymentSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        const result = await this.settings.update(ctx, args.input);
        return { settings: result.value, errors: result.errors };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async saveBdGatewayCredentials(
        @Ctx() ctx: RequestContext,
        @Args() args: { gateway: string; mode: string; input: unknown },
    ) {
        const { gateway, mode } = gatewayAndMode(args.gateway, args.mode);
        const result = await this.settings.saveCredentials(ctx, gateway, mode, args.input);
        return { credentials: result.value, errors: result.errors };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async testBdGatewayConnection(
        @Ctx() ctx: RequestContext,
        @Args() args: { gateway: string; mode: string },
    ) {
        const { gateway, mode } = gatewayAndMode(args.gateway, args.mode);
        const result = await this.payments.testConnection(ctx, gateway, mode);
        return { ok: result.ok, message: 'message' in result ? result.message : null };
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPaymentAttempts(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return withOrders(ctx, this.connection, await this.payments.attemptsForOrder(ctx, args.orderId));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPaymentReviews(@Ctx() ctx: RequestContext) {
        return withOrders(ctx, this.connection, await this.payments.reviews(ctx));
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async checkBdPaymentAttempt(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const attempt = await this.payments.check(ctx, args.id);
        return attempt ? (await withOrders(ctx, this.connection, [attempt]))[0] : null;
    }

    @Mutation()
    @Allow(managePaymentsPermission.Permission)
    async reviewBdPayment(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; action: string; note?: string | null },
    ) {
        if (!(REVIEW_ACTIONS as readonly string[]).includes(args.action)) {
            throw new UserInputError('action must be accept, refund or resolve');
        }
        try {
            const attempt = await this.payments.review(ctx, args.id, args.action as ReviewAction, args.note);
            return (await withOrders(ctx, this.connection, [attempt]))[0];
        } catch (error) {
            if (error instanceof OnlinePaymentError) {
                return new BdOnlinePaymentError(
                    error.code,
                    error.code === 'REFUND_FAILED' ? error.message : undefined,
                );
            }
            throw error;
        }
    }
}

@Resolver('BdPaymentReviewResult')
export class BdPaymentReviewResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return value instanceof ErrorResult ? 'BdOnlinePaymentError' : 'BdPaymentAttempt';
    }
}

/** Adds each attempt's order number for the screens. */
async function withOrders(
    ctx: RequestContext,
    connection: TransactionalConnection,
    attempts: BdPaymentAttempt[],
) {
    const ids = [...new Set(attempts.map(attempt => attempt.orderId))];
    const orders = ids.length
        ? await connection.getRepository(ctx, Order).find({
              where: { id: In(ids) },
              select: { id: true, code: true, customFields: { orderNumber: true } },
          })
        : [];
    const byId = new Map(orders.map(order => [String(order.id), order]));
    return attempts.map(attempt => ({
        ...attempt,
        orderCode: byId.get(String(attempt.orderId))?.code ?? null,
        orderNumber: byId.get(String(attempt.orderId))?.customFields.orderNumber ?? null,
        events: attempt.events ?? [],
    }));
}

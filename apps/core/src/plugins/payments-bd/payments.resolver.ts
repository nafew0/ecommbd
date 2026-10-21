import { Args, Mutation, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Allow,
    Ctx,
    isGraphQlErrorResult,
    Permission,
    RequestContext,
    TransactionalConnection,
    Transaction,
    Order,
    UserInputError,
} from '@vendure/core';
import { verifyPaymentPermission } from './constants';
import { shopperCode } from './payment-handlers';
import { codNeedsCode } from './risk';
import { PaymentChecksService } from './payment-checks.service';
import { PaymentRulesService } from './payment-rules.service';
import { PaymentSettingsService } from './payment-settings.service';

const CHOICES = ['cod', 'prepaid'];

@Resolver()
export class PaymentsShopResolver {
    constructor(
        private activeOrderService: ActiveOrderService,
        private rules: PaymentRulesService,
        private connection: TransactionalConnection,
    ) {}

    @Query()
    @Allow(Permission.Owner)
    async bdPaymentOptions(@Ctx() ctx: RequestContext) {
        const order = await this.activeOrder(ctx);
        if (!order) return null;
        const options = await this.rules.options(ctx, order);
        const code = options.codAvailable ? null : shopperCode(options.codUnavailableReason);
        return {
            ...options,
            codOtpRequired: options.codAvailable && (await codNeedsCode(ctx, order)),
            codUnavailableReason: code,
            codUnavailableMessage: code ? ctx.translate(`message.payments-bd.${code}`) : null,
        };
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setBdPaymentChoice(@Ctx() ctx: RequestContext, @Args() args: { choice: string }) {
        if (!CHOICES.includes(args.choice)) {
            throw new UserInputError('choice must be cod or prepaid');
        }
        const order = await this.activeOrder(ctx);
        if (!order) return null;
        await this.connection
            .getRepository(ctx, Order)
            .update(order.id, { customFields: { paymentChoice: args.choice } });
        order.customFields.paymentChoice = args.choice;
        return this.rules.syncCodFee(ctx, order);
    }

    private activeOrder(ctx: RequestContext) {
        return ctx.authorizedAsOwnerOnly ? this.activeOrderService.getActiveOrder(ctx, undefined) : undefined;
    }
}

@Resolver()
export class PaymentsAdminResolver {
    constructor(
        private settings: PaymentSettingsService,
        private checks: PaymentChecksService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    bdPaymentSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    updateBdPaymentSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }

    @Query()
    @Allow(verifyPaymentPermission.Permission)
    bdPaymentsToVerify(@Ctx() ctx: RequestContext) {
        return this.checks.queue(ctx);
    }

    @Mutation()
    @Allow(verifyPaymentPermission.Permission)
    verifyBdPayment(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { paymentId: string; receivedAmount?: number | null } },
    ) {
        return this.checks.verify(ctx, args.input);
    }

    @Mutation()
    @Allow(verifyPaymentPermission.Permission)
    rejectBdPayment(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { paymentId: string; reason: string; note?: string | null } },
    ) {
        return this.checks.reject(ctx, args.input);
    }

    @Mutation()
    @Allow(verifyPaymentPermission.Permission)
    recordBdRefund(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            input: {
                paymentId: string;
                amount: number;
                method: string;
                transactionId?: string | null;
                note?: string | null;
            };
        },
    ) {
        return this.checks.recordRefund(ctx, args.input);
    }

    @Mutation()
    @Allow(verifyPaymentPermission.Permission)
    settleBdRefund(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            input: { refundId: string; method: string; transactionId?: string | null; note?: string | null };
        },
    ) {
        return this.checks.settleRefund(ctx, args.input);
    }
}

const resolveType = (typename: string) => (value: unknown) =>
    isGraphQlErrorResult(value) ? (value as { __typename: string }).__typename : typename;

@Resolver('BdPaymentCheckResult')
export class BdPaymentCheckResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return resolveType('Payment')(value);
    }
}

@Resolver('BdRefundResult')
export class BdRefundResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return resolveType('Refund')(value);
    }
}

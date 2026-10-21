import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import {
    type ErrorResult,
    internal_getRequestContext,
    internal_setRequestContext,
    isGraphQlErrorResult,
    Order,
    parseContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { OrderPolicyService } from './order-policy.service';

class CancellationRefusal extends Error {
    constructor(readonly result: ErrorResult) {
        super(result.message);
    }
}

/**
 * Vendure's own `cancelOrder` (Vendure's Dashboard, API clients) cancels the order lines before the
 * order process can refuse the state change, and its error result doesn't roll that back. So a
 * placed order is checked here before anything changes, under an order-row lock. The whole
 * operation rolls back on an error result. Our admin uses `cancelBdOrder` and its own transaction.
 */
@Injectable()
export class CancelReasonInterceptor implements NestInterceptor {
    constructor(
        private connection: TransactionalConnection,
        private policy: OrderPolicyService,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<GqlContextType>() !== 'graphql') {
            return next.handle();
        }
        const gql = GqlExecutionContext.create(context);
        const info = gql.getInfo<{ fieldName: string; parentType: { name: string } }>();
        if (info.parentType.name !== 'Mutation' || info.fieldName !== 'cancelOrder') {
            return next.handle();
        }
        const orderId = gql.getArgs<{ input?: { orderId?: string } }>().input?.orderId;
        if (!orderId) return next.handle();
        return from(this.cancel(context, next, orderId));
    }

    private async cancel(context: ExecutionContext, next: CallHandler, orderId: string) {
        const { req } = parseContext(context);
        const ctx = internal_getRequestContext(req, context);
        try {
            return await this.connection.withTransaction(ctx, async txCtx => {
                const order = await this.connection
                    .getRepository(txCtx, Order)
                    .createQueryBuilder('target')
                    .innerJoin('target.channels', 'channel', 'channel.id = :channelId', {
                        channelId: ctx.channelId,
                    })
                    .where('target.id = :id', { id: orderId })
                    .setLock('pessimistic_write', undefined, ['target'])
                    .getOne();
                if (order) {
                    const error = await this.policy.cancellationError(txCtx, order);
                    if (error) throw new UserInputError(`error.bd-orders.${error}`);
                }
                internal_setRequestContext(req, txCtx, context);
                try {
                    const result: unknown = await lastValueFrom(next.handle());
                    if (isGraphQlErrorResult(result)) throw new CancellationRefusal(result);
                    return result;
                } finally {
                    internal_setRequestContext(req, ctx, context);
                }
            });
        } catch (error) {
            if (error instanceof CancellationRefusal) return error.result;
            throw error;
        }
    }
}

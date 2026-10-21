import { CANCEL_NEEDS_REASON_FROM } from '@ecommbd/shared';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import { Order, TransactionalConnection, UserInputError } from '@vendure/core';
import { from, type Observable, switchMap } from 'rxjs';

/**
 * Vendure's own `cancelOrder` (Vendure's Dashboard, API clients) cancels the order lines before the
 * order process can refuse the state change, and its error result doesn't roll that back. So a
 * placed, unshipped order without a cancel reason is refused here, before anything changes. Our
 * admin uses `cancelBdOrder`, which sets the reason first.
 */
@Injectable()
export class CancelReasonInterceptor implements NestInterceptor {
    constructor(private connection: TransactionalConnection) {}

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
        return from(this.check(orderId)).pipe(switchMap(() => next.handle()));
    }

    private async check(orderId: string | undefined) {
        if (!orderId) {
            return;
        }
        const order = await this.connection.rawConnection
            .getRepository(Order)
            .findOne({ where: { id: orderId } });
        if (
            order?.orderPlacedAt &&
            CANCEL_NEEDS_REASON_FROM.includes(order.state) &&
            !order.customFields.cancelReason
        ) {
            throw new UserInputError('error.bd-orders.cancel-reason-required');
        }
    }
}

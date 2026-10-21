import { CANCEL_NEEDS_REASON_FROM, cleanText, isBdCancelReason } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { Order, Payment, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { cancelOrderPermission, confirmOrderPermission, packOrderPermission } from './constants';
import { settledAmount } from './order-actions.service';

export type OrderPolicyError =
    | 'permission-required'
    | 'not-allowed'
    | 'cancel-reason-required'
    | 'cancel-note-required'
    | 'refund-required';

/** Applied below the resolvers, including Vendure's own order mutations. */
export function transitionPermissionError(
    ctx: RequestContext,
    toState: string,
): OrderPolicyError | undefined {
    const permission =
        toState === 'Confirmed'
            ? confirmOrderPermission.Permission
            : toState === 'Packed'
              ? packOrderPermission.Permission
              : toState === 'Cancelled'
                ? cancelOrderPermission.Permission
                : undefined;
    if (!permission) return;
    // A scheduler/import context without a request or user is trusted server work. A shopper
    // (including a signed-in shopper) never gains staff permissions through this exception.
    if (ctx.apiType === 'admin' && !ctx.req && !ctx.activeUserId) return;
    if (ctx.apiType !== 'admin' || !ctx.userHasPermissions([Permission.SuperAdmin, permission])) {
        return 'permission-required';
    }
}

@Injectable()
export class OrderPolicyService {
    constructor(private connection: TransactionalConnection) {}

    /** Check BEFORE cancelling lines: Vendure can otherwise change lines before refusing the state. */
    async cancellationError(ctx: RequestContext, order: Order): Promise<OrderPolicyError | undefined> {
        if (!order.orderPlacedAt) return;
        const permissionError = transitionPermissionError(ctx, 'Cancelled');
        if (permissionError) return permissionError;
        if (!CANCEL_NEEDS_REASON_FROM.includes(order.state)) return 'not-allowed';
        if (!isBdCancelReason(order.customFields.cancelReason)) return 'cancel-reason-required';
        if (order.customFields.cancelReason === 'other' && !cleanText(order.customFields.cancelNote ?? '')) {
            return 'cancel-note-required';
        }
        // Money received and kept: settled payments minus their settled refunds (phase 08). An
        // authorization is not money received, and a pending or failed refund isn't money paid back.
        const payments = await this.connection.getRepository(ctx, Payment).find({
            where: { order: { id: order.id }, state: 'Settled' },
            relations: { refunds: true },
        });
        if (settledAmount({ payments }) > 0) return 'refund-required';
    }
}

import { bdStatusOf, CANCEL_NEEDS_REASON_FROM, isBdTransitionAllowed } from '@ecommbd/shared';
import {
    AdministratorService,
    EventBus,
    Order,
    type OrderProcess,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { MoreThanOrEqual, Not } from 'typeorm';
import { DUPLICATE_WINDOW_MINUTES } from './constants';
import {
    type ActingStaff,
    BdOrderCancelledWithReasonEvent,
    BdOrderConfirmedEvent,
    BdOrderPackedEvent,
    BdOrderReturnedEvent,
} from './events';
import { nextOrderNumber } from './order-number';
import { OrderSettingsService } from './order-settings.service';
import { OrderPolicyService, transitionPermissionError } from './order-policy.service';

declare module '@vendure/core/dist/service/helpers/order-state-machine/order-state' {
    interface CustomOrderStates {
        Confirmed: never;
        Packed: never;
        Returned: never;
    }
}

/**
 * The BD order workflow on Vendure's order process (roadmap phase 04,
 * docs/decisions/order-states.md):
 * - adds Confirmed, Packed and Returned, and refuses every transition between placed states that
 *   the shared table (`isBdTransitionAllowed`) doesn't list;
 * - cancelling a placed order needs a reason;
 * - at placement: the order number, the place in the confirmation queue, the duplicate check;
 * - publishes our order events (never for imported orders).
 */
export function createBdOrderProcess(): OrderProcess<'Confirmed' | 'Packed' | 'Returned'> {
    let settings: OrderSettingsService;
    let connection: TransactionalConnection;
    let eventBus: EventBus;
    let administrators: AdministratorService;
    let policy: OrderPolicyService;

    async function actingStaff(ctx: RequestContext): Promise<ActingStaff> {
        const administrator = ctx.activeUserId
            ? await administrators.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        return administrator
            ? {
                  administratorId: administrator.id,
                  name: `${administrator.firstName} ${administrator.lastName}`.trim(),
              }
            : { administratorId: null, name: null };
    }

    /** The order number of a recent order by the same customer with exactly the same items. */
    async function findDuplicate(ctx: RequestContext, order: Order): Promise<string | null> {
        if (!order.customerId || !order.orderPlacedAt) {
            return null;
        }
        const since = new Date(order.orderPlacedAt.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000);
        const others = await connection.getRepository(ctx, Order).find({
            where: {
                customer: { id: order.customerId },
                id: Not(order.id),
                orderPlacedAt: MoreThanOrEqual(since),
                state: Not('Cancelled'),
            },
            relations: { lines: true },
            order: { orderPlacedAt: 'DESC' },
        });
        const signature = lineSignature(order);
        return (
            others.find(other => other.customFields.orderNumber && lineSignature(other) === signature)
                ?.customFields.orderNumber ?? null
        );
    }

    return {
        transitions: {
            PaymentAuthorized: { to: ['Confirmed'] },
            PaymentSettled: { to: ['Confirmed', 'Packed'] },
            Confirmed: { to: ['Packed', 'Cancelled'] },
            Packed: { to: ['Shipped', 'PartiallyShipped', 'Cancelled'] },
            Shipped: { to: ['Returned'] },
            PartiallyDelivered: { to: ['Returned'] },
            Returned: { to: [] },
        },

        init(injector) {
            settings = injector.get(OrderSettingsService);
            connection = injector.get(TransactionalConnection);
            eventBus = injector.get(EventBus);
            administrators = injector.get(AdministratorService);
            policy = injector.get(OrderPolicyService);
        },

        async onTransitionStart(fromState, toState, { ctx, order }) {
            const permissionError =
                order.orderPlacedAt || toState !== 'Cancelled'
                    ? transitionPermissionError(ctx, toState)
                    : undefined;
            if (permissionError) return `message.bd-orders.${permissionError}`;
            const { skipConfirmationForPrepaid } = await settings.get(ctx);
            if (!isBdTransitionAllowed(fromState, toState, { skipConfirmationForPrepaid })) {
                return fromState === 'PaymentSettled' && toState === 'Packed'
                    ? 'message.bd-orders.confirm-first'
                    : 'message.bd-orders.not-allowed';
            }
            if (toState === 'Cancelled') {
                const error = await policy.cancellationError(ctx, order);
                if (error) return `message.bd-orders.${error}`;
            }
        },

        // Runs after Vendure's own process, which sets orderPlacedAt. Changes to `order` here are
        // saved by Vendure in the same transaction.
        async onTransitionEnd(fromState, toState, { ctx, order }) {
            const fields = order.customFields;
            if (order.orderPlacedAt && !fields.orderNumber) {
                const { orderNumberPrefix } = await settings.get(ctx);
                fields.orderNumber = await nextOrderNumber(connection, ctx, orderNumberPrefix);
                if (!fields.imported) {
                    fields.possibleDuplicateOf = await findDuplicate(ctx, order);
                }
            }
            const wasNew = bdStatusOf(fromState) === 'new';
            const isNew = bdStatusOf(toState) === 'new';
            if (isNew && !wasNew && order.orderPlacedAt && !fields.imported && !fields.confirmQueueAt) {
                // Placed now, or back from an edit: into the confirmation queue.
                fields.confirmQueueAt = fromState === 'ArrangingPayment' ? order.orderPlacedAt : new Date();
            }
            if (wasNew && !isNew) {
                fields.confirmQueueAt = null;
                fields.claimedByUserId = null;
                fields.claimedByName = null;
                fields.claimedUntil = null;
            }
            if (fields.imported) {
                return;
            }
            const event =
                toState === 'Confirmed'
                    ? BdOrderConfirmedEvent
                    : toState === 'Packed'
                      ? BdOrderPackedEvent
                      : toState === 'Returned'
                        ? BdOrderReturnedEvent
                        : toState === 'Cancelled' && CANCEL_NEEDS_REASON_FROM.includes(fromState)
                          ? BdOrderCancelledWithReasonEvent
                          : undefined;
            if (event) {
                await eventBus.publish(new event(ctx, order, await actingStaff(ctx)));
            }
        },
    };
}

/** The items of an order, independent of line order: "12:1,15:2". */
function lineSignature(order: Order): string {
    return order.lines
        .filter(line => line.quantity > 0)
        .map(line => `${line.productVariantId}:${line.quantity}`)
        .sort()
        .join(',');
}

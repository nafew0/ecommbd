import {
    DefaultOrderPlacedStrategy,
    DefaultStockAllocationStrategy,
    type Injector,
    Logger,
    type Order,
    OrderService,
    type OrderProcess,
    PaymentService,
    type OrderState,
    type Payment,
    type PaymentProcess,
    type RequestContext,
} from '@vendure/core';
import type { OnlinePaymentSettings } from '@ecommbd/shared';
import { loggerCtx } from './constants';

/**
 * How an unpaid online order is placed (phase 18, docs/decisions/order-states.md): the online
 * payment is `Pending` (a custom payment state that isn't money received); once the order's
 * payments cover the total counting it, the order moves from ArrangingPayment to AwaitingPayment,
 * which counts as placed (order number, stock allocated) but stays out of the confirmation queue.
 * The gateway's confirmation settles the payment and Vendure moves the order on to PaymentSettled,
 * or to PaymentAuthorized when it was an advance with COD for the rest.
 */

const isPlacing = (fromState: OrderState, toState: OrderState) =>
    fromState === 'ArrangingPayment' && toState === 'AwaitingPayment';

/** Vendure's rule (ArrangingPayment → PaymentAuthorized/PaymentSettled) plus AwaitingPayment. */
export class BdOrderPlacedStrategy extends DefaultOrderPlacedStrategy {
    shouldSetAsPlaced(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean {
        return isPlacing(fromState, toState) || super.shouldSetAsPlaced(ctx, fromState, toState, order);
    }
}

/** Stock is allocated when the order is placed, AwaitingPayment included (released if it expires). */
export class BdStockAllocationStrategy extends DefaultStockAllocationStrategy {
    shouldAllocateStock(ctx: RequestContext, fromState: OrderState, toState: OrderState, order: Order) {
        return isPlacing(fromState, toState) || super.shouldAllocateStock(ctx, fromState, toState, order);
    }
}

export const isOnline = (payment: Pick<Payment, 'method' | 'metadata'>) =>
    (payment.metadata as { kind?: string } | null)?.kind === 'gateway';

const COVERING = new Set(['Authorized', 'Settled', 'Pending']);

/** The payments cover the total when the pending online payment counts, and one is pending. */
export function coveredWithPending(order: Order, payments: Payment[]): boolean {
    const live = payments.filter(payment => COVERING.has(payment.state));
    const covered = live.reduce((sum, payment) => sum + payment.amount, 0);
    return live.some(payment => payment.state === 'Pending') && covered >= order.totalWithTax;
}

export function createOnlineOrderProcess(): OrderProcess<'AwaitingPayment'> {
    let orderService: OrderService;
    let paymentService: PaymentService;
    return {
        transitions: {
            ArrangingPayment: { to: ['AwaitingPayment'] },
            AwaitingPayment: { to: ['PaymentSettled', 'PaymentAuthorized', 'Cancelled'] },
        },
        init(injector: Injector) {
            orderService = injector.get(OrderService);
            paymentService = injector.get(PaymentService);
        },
        async onTransitionStart(fromState, toState, { ctx, order }) {
            if (toState !== 'AwaitingPayment') return;
            const payments = await orderService.getOrderPayments(ctx, order.id);
            if (!coveredWithPending(order, payments)) {
                return 'message.payments-online.not-covered';
            }
        },
        // Back to the cart (a later payment was refused): an online payment started for it can't be
        // used any more, so it's cancelled and the next try starts fresh.
        async onTransitionEnd(fromState, toState, { ctx, order }) {
            if (fromState !== 'ArrangingPayment' || toState !== 'AddingItems') return;
            const payments = await orderService.getOrderPayments(ctx, order.id);
            for (const payment of payments.filter(item => item.state === 'Pending')) {
                await paymentService.cancelPayment(ctx, payment.id);
            }
        },
    };
}

/**
 * `Pending`: the online payment between "started" and the gateway's answer. Only our service moves
 * it on: Settled (the gateway confirmed it), Declined (it failed and can't be retried), Cancelled
 * (the order expired or was cancelled). When adding it covers the order, the order moves to
 * AwaitingPayment (Vendure's own process only moves orders for Authorized or Settled payments).
 */
export function createOnlinePaymentProcess(
    onPending: (ctx: RequestContext, payment: Payment, order: Order) => Promise<void>,
): PaymentProcess<'Pending'> {
    let orderService: OrderService;
    return {
        transitions: {
            Created: { to: ['Pending'] },
            Pending: { to: ['Settled', 'Declined', 'Cancelled', 'Error'] },
        },
        init(injector: Injector) {
            orderService = injector.get(OrderService);
        },
        onTransitionStart(fromState, toState, { payment }) {
            if (toState === 'Pending' && payment.method && !isOnline(payment)) {
                return 'Only online payments wait for the gateway';
            }
        },
        async onTransitionEnd(fromState, toState, { ctx, payment, order }) {
            if (fromState === 'Created' && toState === 'Pending') {
                await onPending(ctx, payment, order);
            }
            // After any payment is added, the order may now be covered with the pending one.
            if (fromState !== 'Created') return;
            const current = await orderService.findOne(ctx, order.id);
            if (current?.state !== 'ArrangingPayment') return;
            const payments = await orderService.getOrderPayments(ctx, order.id);
            if (!coveredWithPending(current, payments)) return;
            const result = await orderService.transitionToState(ctx, order.id, 'AwaitingPayment');
            if (result && 'errorCode' in result) {
                Logger.warn(`Order ${order.id} could not wait for payment: ${result.message}`, loggerCtx);
            }
        },
    };
}

/** Whether an order waiting for an online advance should keep waiting instead of expiring. */
export function keepsWaiting(settings: OnlinePaymentSettings, payments: Payment[]): boolean {
    return (
        settings.keepAdvanceOrdersWaiting &&
        payments.some(
            payment =>
                payment.state === 'Pending' &&
                (payment.metadata as { purpose?: string } | null)?.purpose === 'advance',
        )
    );
}

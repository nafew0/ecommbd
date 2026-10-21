import {
    cleanText,
    isWholeTaka,
    lookalikeCharacters,
    PAYMENT_LIMITS,
    PAYMENT_REJECT_REASONS,
    type PaymentRejectReason,
    REFUND_METHODS,
    textLength,
} from '@ecommbd/shared';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
    ErrorResult,
    EventBus,
    HistoryService,
    isGraphQlErrorResult,
    Logger,
    Order,
    OrderService,
    OrderStateTransitionEvent,
    Payment,
    PaymentService,
    Refund,
    RequestContext,
    TransactionalConnection,
    VendureEvent,
} from '@vendure/core';
import { In } from 'typeorm';
import { settledAmount } from '../bd-orders';
import { COD_METHOD_CODE, loggerCtx, MFS_METHOD_CODES, PAYMENT_CHECK_HISTORY_TYPE } from './constants';
import { PaymentSettingsService } from './payment-settings.service';
import type { MfsPaymentMetadata } from './types';

const REJECT_REASONS = PAYMENT_REJECT_REASONS;
type RejectReason = PaymentRejectReason;

export const PAYMENT_ERROR_CODES = [
    'PAYMENT_NOT_FOUND',
    'ALREADY_CHECKED',
    'INVALID_AMOUNT',
    'INVALID_REASON',
    'NOTE_REQUIRED',
    'NOTE_TOO_LONG',
    'INVALID_METHOD',
    'REFUND_TOO_LARGE',
    'REFUND_FAILED',
] as const;
export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

/** A refused staff action, translated like Vendure's own errors (`errorResult.BD_PAYMENT.<reason>`). */
export class BdPaymentError extends ErrorResult {
    readonly __typename = 'BdPaymentError';
    readonly errorCode = 'BD_PAYMENT_ERROR' as never;
    readonly message: string;
    constructor(readonly reason: PaymentErrorCode) {
        super();
        this.message = `BD_PAYMENT.${reason}`;
    }
}

/** Staff verified or rejected a mobile banking payment (SMS to the shopper in phase 10). */
export class BdPaymentCheckedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public order: Order,
        public payment: Payment,
        public outcome: 'verified' | 'rejected',
        public reason?: RejectReason,
    ) {
        super();
    }
}

const NOTE_LIMIT = 500;
const MFS_CODES = Object.values(MFS_METHOD_CODES);

/**
 * The staff side of payments (phase 08): the Verify payments queue, verifying or rejecting a
 * mobile banking payment, refund records, and settling COD when the order is delivered. Every check
 * is a person's action with the VerifyPayment permission, recorded in the order history.
 */
@Injectable()
export class PaymentChecksService implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private historyService: HistoryService,
        private settings: PaymentSettingsService,
        private eventBus: EventBus,
    ) {}

    onApplicationBootstrap() {
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(event => {
            if (event.toState === 'Delivered') {
                this.settleCodOnDelivery(event.ctx, event.order.id).catch(error =>
                    Logger.error(
                        `Could not settle COD for order ${event.order.id}: ${String(error)}`,
                        loggerCtx,
                    ),
                );
            }
        });
    }

    /** Mobile banking payments waiting for a person to check the statement, oldest first. */
    async queue(ctx: RequestContext) {
        const { reminderHours } = await this.settings.get(ctx);
        const payments = await this.connection.getRepository(ctx, Payment).find({
            where: { method: In(MFS_CODES), state: 'Authorized' },
            relations: { order: true },
            order: { createdAt: 'ASC' },
            take: 500,
        });
        const overdueBefore = Date.now() - reminderHours * 60 * 60 * 1000;
        return payments
            .filter(payment => (payment.metadata as MfsPaymentMetadata).verification === 'pending')
            .map(payment => {
                const metadata = payment.metadata as MfsPaymentMetadata;
                const order = payment.order;
                return {
                    paymentId: payment.id,
                    orderId: order.id,
                    orderCode: order.code,
                    orderNumber: order.customFields.orderNumber ?? null,
                    customerName: order.shippingAddress?.fullName ?? '',
                    customerPhone: order.shippingAddress?.phoneNumber ?? '',
                    orderTotal: order.totalWithTax,
                    provider: metadata.provider,
                    senderNumber: metadata.senderNumber,
                    transactionId: metadata.transactionId,
                    lookalikes: lookalikeCharacters(metadata.transactionId),
                    purpose: metadata.purpose,
                    amount: payment.amount,
                    createdAt: payment.createdAt,
                    overdue: payment.createdAt.getTime() < overdueBefore,
                };
            });
    }

    /** Settles the payment for what the statement shows. Less than expected: the rest is collected on delivery. */
    async verify(ctx: RequestContext, input: { paymentId: string; receivedAmount?: number | null }) {
        return this.connection.withTransaction(ctx, async txCtx => {
            const payment = await this.lockPending(txCtx, input.paymentId);
            if (payment instanceof BdPaymentError) return payment;
            const metadata = payment.metadata as MfsPaymentMetadata;
            const received = input.receivedAmount ?? metadata.expectedAmount;
            if (
                !Number.isSafeInteger(received) ||
                received <= 0 ||
                received > PAYMENT_LIMITS.maxAmount ||
                !isWholeTaka(received)
            ) {
                return new BdPaymentError('INVALID_AMOUNT');
            }
            const checked: MfsPaymentMetadata = {
                ...metadata,
                verification: 'verified',
                receivedAmount: received,
                checkedBy: await this.staffName(txCtx),
                checkedAt: new Date().toISOString(),
                public: { ...metadata.public, verification: 'verified' },
            };
            await this.connection.getRepository(txCtx, Payment).update(payment.id, {
                // Overpaid: the payment stays at the expected amount, and staff refund the difference.
                amount: Math.min(received, metadata.expectedAmount),
                metadata: checked as never,
            });
            const settled = await this.orderService.settlePayment(txCtx, payment.id);
            if (isGraphQlErrorResult(settled)) {
                throw new Error(`Could not settle payment ${payment.id}: ${settled.message}`);
            }
            await this.history(txCtx, payment, {
                outcome: 'verified',
                received,
                expected: metadata.expectedAmount,
            });
            await this.publish(txCtx, payment.id, 'verified');
            return this.findPayment(txCtx, payment.id);
        });
    }

    async reject(ctx: RequestContext, input: { paymentId: string; reason: string; note?: string | null }) {
        if (!(REJECT_REASONS as readonly string[]).includes(input.reason)) {
            return new BdPaymentError('INVALID_REASON');
        }
        const note = cleanText(input.note ?? '');
        if (textLength(note) > NOTE_LIMIT) return new BdPaymentError('NOTE_TOO_LONG');
        if (input.reason === 'other' && !note) return new BdPaymentError('NOTE_REQUIRED');
        const reason = input.reason as RejectReason;
        return this.connection.withTransaction(ctx, async txCtx => {
            const payment = await this.lockPending(txCtx, input.paymentId);
            if (payment instanceof BdPaymentError) return payment;
            const metadata = payment.metadata as MfsPaymentMetadata;
            await this.connection.getRepository(txCtx, Payment).update(payment.id, {
                metadata: {
                    ...metadata,
                    verification: 'rejected',
                    rejectReason: note ? `${reason}: ${note}` : reason,
                    checkedBy: await this.staffName(txCtx),
                    checkedAt: new Date().toISOString(),
                    public: { ...metadata.public, verification: 'rejected' },
                } satisfies MfsPaymentMetadata as never,
            });
            const declined = await this.paymentService.transitionToState(txCtx, payment.id, 'Declined');
            if (isGraphQlErrorResult(declined)) {
                throw new Error(`Could not decline payment ${payment.id}: ${declined.message}`);
            }
            await this.history(txCtx, payment, {
                outcome: 'rejected',
                expected: metadata.expectedAmount,
                reason: note ? `${reason}: ${note}` : reason,
            });
            await this.publish(txCtx, payment.id, 'rejected', reason);
            return this.findPayment(txCtx, payment.id);
        });
    }

    /**
     * Records money given back (staff send it themselves): needed before cancelling an order with
     * money received. Never more than the payment minus earlier refunds.
     */
    async recordRefund(
        ctx: RequestContext,
        input: {
            paymentId: string;
            amount: number;
            method: string;
            transactionId?: string | null;
            note?: string | null;
        },
    ) {
        if (!(REFUND_METHODS as readonly string[]).includes(input.method)) {
            return new BdPaymentError('INVALID_METHOD');
        }
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !isWholeTaka(input.amount)) {
            return new BdPaymentError('INVALID_AMOUNT');
        }
        const note = cleanText(input.note ?? '');
        if (textLength(note) > NOTE_LIMIT) return new BdPaymentError('NOTE_TOO_LONG');
        const transactionId = cleanText(input.transactionId ?? '').slice(0, 40) || null;
        return this.connection.withTransaction(ctx, async txCtx => {
            const payment = await this.connection
                .getRepository(txCtx, Payment)
                .createQueryBuilder('payment')
                .setLock('pessimistic_write')
                .where('payment.id = :id', { id: input.paymentId })
                .getOne();
            if (!payment || payment.state !== 'Settled') {
                return new BdPaymentError('PAYMENT_NOT_FOUND');
            }
            const refunds = await this.connection
                .getRepository(txCtx, Refund)
                .find({ where: { paymentId: payment.id, state: 'Settled' } });
            const refunded = refunds.reduce((sum, refund) => sum + refund.total, 0);
            if (input.amount > payment.amount - refunded) {
                return new BdPaymentError('REFUND_TOO_LARGE');
            }
            const refund = await this.orderService.refundOrder(txCtx, {
                paymentId: payment.id,
                amount: input.amount,
                reason: note || input.method,
            });
            if (isGraphQlErrorResult(refund)) {
                Logger.warn(`Refund refused for payment ${payment.id}: ${refund.message}`, loggerCtx);
                return new BdPaymentError('REFUND_FAILED');
            }
            await this.connection.getRepository(txCtx, Refund).update(refund.id, {
                transactionId: transactionId ?? undefined,
                method: input.method,
                metadata: { method: input.method, note, recordedBy: await this.staffName(txCtx) } as never,
            });
            return this.connection.getRepository(txCtx, Refund).findOneOrFail({ where: { id: refund.id } });
        });
    }

    /**
     * When an order is delivered, its COD payment is settled for what the courier collected: the
     * total minus money already received.
     */
    async settleCodOnDelivery(ctx: RequestContext, orderId: Order['id']) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.orderService.findOne(txCtx, orderId, ['payments', 'payments.refunds']);
            if (!order) return;
            const received = settledAmount(order);
            for (const payment of order.payments.filter(
                p => p.method === COD_METHOD_CODE && p.state === 'Authorized',
            )) {
                const due = Math.max(0, order.totalWithTax - received);
                if (due === 0) {
                    await this.orderService.cancelPayment(txCtx, payment.id);
                    continue;
                }
                await this.connection.getRepository(txCtx, Payment).update(payment.id, { amount: due });
                await this.orderService.settlePayment(txCtx, payment.id);
            }
        });
    }

    private async lockPending(ctx: RequestContext, paymentId: string): Promise<Payment | BdPaymentError> {
        const payment = await this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('payment')
            .setLock('pessimistic_write')
            .where('payment.id = :id', { id: paymentId })
            .getOne();
        if (!payment || !MFS_CODES.includes(payment.method)) {
            return new BdPaymentError('PAYMENT_NOT_FOUND');
        }
        if (
            payment.state !== 'Authorized' ||
            (payment.metadata as MfsPaymentMetadata).verification !== 'pending'
        ) {
            return new BdPaymentError('ALREADY_CHECKED');
        }
        return payment;
    }

    private findPayment(ctx: RequestContext, id: Payment['id']) {
        return this.connection.getRepository(ctx, Payment).findOneOrFail({ where: { id } });
    }

    private async history(
        ctx: RequestContext,
        payment: Payment,
        data: { outcome: 'verified' | 'rejected'; received?: number; expected: number; reason?: string },
    ) {
        const orderId = await this.orderIdOf(ctx, payment);
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId,
            type: PAYMENT_CHECK_HISTORY_TYPE,
            data: { paymentId: String(payment.id), ...data },
        });
    }

    private async publish(
        ctx: RequestContext,
        paymentId: Payment['id'],
        outcome: 'verified' | 'rejected',
        reason?: RejectReason,
    ) {
        const payment = await this.connection
            .getRepository(ctx, Payment)
            .findOneOrFail({ where: { id: paymentId }, relations: { order: true } });
        await this.eventBus.publish(new BdPaymentCheckedEvent(ctx, payment.order, payment, outcome, reason));
    }

    private async orderIdOf(ctx: RequestContext, payment: Payment): Promise<Order['id']> {
        if (payment.order) return payment.order.id;
        const row = await this.connection
            .getRepository(ctx, Payment)
            .findOneOrFail({ where: { id: payment.id }, relations: { order: true } });
        return row.order.id;
    }

    private async staffName(ctx: RequestContext): Promise<string> {
        const user = ctx.activeUserId;
        if (!user) return '';
        const [row] = await this.connection.rawConnection.query(
            'SELECT "firstName", "lastName" FROM "administrator" WHERE "userId" = $1',
            [user],
        );
        return row ? `${row.firstName} ${row.lastName}`.trim() : '';
    }
}

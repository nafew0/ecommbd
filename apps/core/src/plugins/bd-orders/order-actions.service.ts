import {
    type BdOrderAction,
    type BdOrderStatus,
    bdActionsFor,
    bdPaymentType,
    bdStatusOf,
    CHECKOUT_LIMITS,
    cleanText,
    isBdCancelReason,
    shouldSuggestCancel,
    textLength,
    vendureStatesOf,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    AdministratorService,
    HistoryService,
    type ID,
    isGraphQlErrorResult,
    Logger,
    manualFulfillmentHandler,
    Order,
    OrderHistoryEntry,
    OrderService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not } from 'typeorm';
import { CALL_ATTEMPT_HISTORY_TYPE, CLAIM_MINUTES, loggerCtx } from './constants';
import { BdOrderActionError, type OrderActionErrorCode } from './errors';
import { OrderSettingsService } from './order-settings.service';

type ActionResult = Promise<Order | BdOrderActionError>;
const STATE_TRANSITION = 'ORDER_STATE_TRANSITION' as OrderHistoryEntry['type'];

export interface OrderActionInput {
    orderId: ID;
    /** The status the staff member saw. If the order has moved on since, nothing is done. */
    expectedStatus?: BdOrderStatus | null;
}

export interface CallAttemptInput {
    orderId: ID;
    outcome: string;
    /** With `callLater`: when to call again (ISO). */
    callBackAt?: string | null;
    note?: string | null;
}

const MAX_CALL_LATER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thrown inside a transaction to roll it back and return the error to staff. */
class Refusal extends Error {
    constructor(readonly result: BdOrderActionError) {
        super(result.reason);
    }
}

const refuse = (code: OrderActionErrorCode, details?: string[]) =>
    new Refusal(new BdOrderActionError(code, { details }));

/**
 * What staff do with orders (roadmap phase 04): confirm, cancel with a reason, pack, mark shipped,
 * delivered or returned, record calls, and claim an order while calling.
 *
 * Every action runs in one transaction that first locks the order row (`SELECT … FOR UPDATE`), so
 * two staff acting at once are served one after the other; the second sees the order has moved on
 * (`ALREADY_CHANGED`, with who did it and when) instead of a double change.
 */
@Injectable()
export class OrderActionsService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private historyService: HistoryService,
        private administrators: AdministratorService,
        private productVariantService: ProductVariantService,
        private settings: OrderSettingsService,
    ) {}

    confirm(
        ctx: RequestContext,
        input: OrderActionInput & { ignoreStockWarning?: boolean | null },
    ): ActionResult {
        return this.act(ctx, input, 'confirm', async (txCtx, order) => {
            if (!input.ignoreStockWarning) {
                const short = await this.stockShortages(txCtx, order);
                if (short.length) {
                    throw refuse('INSUFFICIENT_STOCK', short);
                }
            }
            return this.transition(txCtx, order.id, 'Confirmed');
        });
    }

    /** Confirms several orders that staff have already checked; each one on its own. */
    async confirmMany(ctx: RequestContext, orderIds: ID[]): Promise<Array<Order | BdOrderActionError>> {
        const results: Array<Order | BdOrderActionError> = [];
        for (const orderId of orderIds) {
            results.push(await this.confirm(ctx, { orderId, expectedStatus: 'new' }));
        }
        return results;
    }

    async cancel(
        ctx: RequestContext,
        input: OrderActionInput & { reason: string; note?: string | null },
    ): ActionResult {
        if (!isBdCancelReason(input.reason)) {
            return new BdOrderActionError('INVALID_REASON');
        }
        const note = cleanText(input.note ?? '');
        if (textLength(note) > CHECKOUT_LIMITS.note) {
            return new BdOrderActionError('NOTE_TOO_LONG');
        }
        if (input.reason === 'other' && !note) {
            return new BdOrderActionError('NOTE_REQUIRED');
        }
        const reason = input.reason;
        return this.act(ctx, input, 'cancel', async (txCtx, order) => {
            const received = settledAmount(order);
            if (received > 0) {
                throw refuse('REFUND_REQUIRED');
            }
            await this.updateFields(txCtx, order.id, { cancelReason: reason, cancelNote: note || null });
            const result = await this.orderService.cancelOrder(txCtx, {
                orderId: order.id,
                reason,
                cancelShipping: true,
            });
            if (isGraphQlErrorResult(result)) {
                throw refuse('NOT_ALLOWED', [result.message]);
            }
            return result;
        });
    }

    pack(ctx: RequestContext, input: OrderActionInput): ActionResult {
        return this.act(ctx, input, 'pack', (txCtx, order) => this.transition(txCtx, order.id, 'Packed'));
    }

    /**
     * Hands every item to delivery with a manual fulfillment: by hand, or when the courier picks the
     * parcel up (phase 19 passes the courier's name and consignment ID).
     */
    markShipped(
        ctx: RequestContext,
        input: OrderActionInput & { shipment?: { method: string; trackingCode: string } },
    ): ActionResult {
        return this.act(ctx, input, 'ship', async (txCtx, order) => {
            const fulfillment = await this.orderService.createFulfillment(txCtx, {
                lines: order.lines
                    .filter(line => line.quantity > 0)
                    .map(line => ({ orderLineId: line.id, quantity: line.quantity })),
                handler: {
                    code: manualFulfillmentHandler.code,
                    arguments: [
                        { name: 'method', value: input.shipment?.method ?? 'Manual' },
                        { name: 'trackingCode', value: input.shipment?.trackingCode ?? '' },
                    ],
                },
            });
            if (isGraphQlErrorResult(fulfillment)) {
                throw refuse('NOT_ALLOWED', [fulfillment.message]);
            }
            const shipped = await this.orderService.transitionFulfillmentToState(
                txCtx,
                fulfillment.id,
                'Shipped',
            );
            if (isGraphQlErrorResult(shipped)) {
                throw refuse('NOT_ALLOWED', [shipped.message]);
            }
            return this.reload(txCtx, order.id);
        });
    }

    markDelivered(ctx: RequestContext, input: OrderActionInput): ActionResult {
        return this.act(ctx, input, 'deliver', async (txCtx, order) => {
            const fulfillments = await this.orderService.getOrderFulfillments(txCtx, order);
            for (const fulfillment of fulfillments.filter(candidate => candidate.state === 'Shipped')) {
                const delivered = await this.orderService.transitionFulfillmentToState(
                    txCtx,
                    fulfillment.id,
                    'Delivered',
                );
                if (isGraphQlErrorResult(delivered)) {
                    throw refuse('NOT_ALLOWED', [delivered.message]);
                }
            }
            return this.reload(txCtx, order.id);
        });
    }

    markReturned(ctx: RequestContext, input: OrderActionInput & { note?: string | null }): ActionResult {
        const note = cleanText(input.note ?? '');
        if (textLength(note) > CHECKOUT_LIMITS.note) {
            return Promise.resolve(new BdOrderActionError('NOTE_TOO_LONG'));
        }
        return this.act(ctx, input, 'return', async (txCtx, order) => {
            const returned = await this.transition(txCtx, order.id, 'Returned');
            if (note) {
                await this.orderService.addNoteToOrder(txCtx, { id: order.id, note, isPublic: false });
            }
            return returned;
        });
    }

    /**
     * "No answer" counts a failed call and moves the order to the bottom of the queue; "Call later"
     * hides it until the chosen time. Each is an order history entry with the staff member.
     */
    async recordCallAttempt(ctx: RequestContext, input: CallAttemptInput): ActionResult {
        if (input.outcome !== 'noAnswer' && input.outcome !== 'callLater') {
            return new BdOrderActionError('INVALID_OUTCOME');
        }
        const outcome = input.outcome;
        const now = new Date();
        let callBackAt: Date | null = null;
        if (outcome === 'callLater') {
            callBackAt = input.callBackAt ? new Date(input.callBackAt) : null;
            const latest = now.getTime() + MAX_CALL_LATER_DAYS * DAY_MS;
            if (
                !callBackAt ||
                Number.isNaN(callBackAt.getTime()) ||
                callBackAt <= now ||
                callBackAt.getTime() > latest
            ) {
                return new BdOrderActionError('INVALID_TIME');
            }
        }
        const note = cleanText(input.note ?? '');
        if (textLength(note) > CHECKOUT_LIMITS.note) {
            return new BdOrderActionError('NOTE_TOO_LONG');
        }
        return this.act(ctx, input, null, async (txCtx, order) => {
            if (bdStatusOf(order.state) !== 'new' || !order.customFields.confirmQueueAt) {
                throw refuse('NOT_IN_QUEUE');
            }
            await this.updateFields(txCtx, order.id, {
                confirmQueueAt: callBackAt ?? now,
                callAttempts: (order.customFields.callAttempts ?? 0) + (outcome === 'noAnswer' ? 1 : 0),
                lastCallAt: now,
                claimedByUserId: null,
                claimedByName: null,
                claimedUntil: null,
            });
            await this.historyService.createHistoryEntryForOrder(
                {
                    ctx: txCtx,
                    orderId: order.id,
                    type: CALL_ATTEMPT_HISTORY_TYPE,
                    data: {
                        outcome,
                        ...(callBackAt ? { callBackAt: callBackAt.toISOString() } : {}),
                        ...(note ? { note } : {}),
                    },
                },
                false,
            );
            return this.reload(txCtx, order.id);
        });
    }

    /**
     * Opening a New order claims it for 5 minutes, so others see "Rahim is calling". A live claim by
     * someone else is left alone (the order comes back with their claim); an expired one is taken over.
     */
    claim(ctx: RequestContext, orderId: ID): ActionResult {
        return this.act(ctx, { orderId }, null, async (txCtx, order) => {
            const fields = order.customFields;
            const heldByOther =
                fields.claimedUntil &&
                fields.claimedUntil > new Date() &&
                fields.claimedByUserId !== String(ctx.activeUserId);
            if (bdStatusOf(order.state) === 'new' && !heldByOther && ctx.activeUserId) {
                const administrator = await this.administrators.findOneByUserId(txCtx, ctx.activeUserId);
                await this.updateFields(txCtx, order.id, {
                    claimedByUserId: String(ctx.activeUserId),
                    claimedByName: administrator
                        ? `${administrator.firstName} ${administrator.lastName}`.trim()
                        : null,
                    claimedUntil: new Date(Date.now() + CLAIM_MINUTES * 60_000),
                });
            }
            return this.reload(txCtx, order.id);
        });
    }

    /** Lets go of one's own claim (closing the order, or after a call). */
    async releaseClaim(ctx: RequestContext, orderId: ID): Promise<boolean> {
        const result = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update(Order)
            .set({
                customFields: { claimedByUserId: null, claimedByName: null, claimedUntil: null },
            } as never)
            .where('id = :id', { id: orderId })
            .andWhere('"customFieldsClaimedbyuserid" = :userId', { userId: String(ctx.activeUserId) })
            .execute();
        return (result.affected ?? 0) > 0;
    }

    /**
     * The auto-cancel task: cancels New orders that nobody could reach, but only when the merchant
     * has turned on "cancel automatically". Returns how many were cancelled.
     */
    async autoCancelUnreachable(ctx: RequestContext): Promise<number> {
        const { autoCancel } = await this.settings.get(ctx);
        if (!autoCancel.cancelAutomatically) {
            return 0;
        }
        const placedBefore = new Date(Date.now() - autoCancel.afterDays * DAY_MS);
        const candidates = await this.connection.getRepository(ctx, Order).find({
            select: { id: true, orderPlacedAt: true, customFields: { callAttempts: true } },
            where: {
                state: In(vendureStatesOf('new')),
                orderPlacedAt: LessThanOrEqual(placedBefore),
                customFields: {
                    imported: false,
                    confirmQueueAt: Not(IsNull()),
                    callAttempts: MoreThanOrEqual(autoCancel.minFailedCalls),
                },
            },
        });
        let cancelled = 0;
        for (const order of candidates) {
            const due = shouldSuggestCancel(
                { placedAt: order.orderPlacedAt!, failedCalls: order.customFields.callAttempts ?? 0 },
                autoCancel,
            );
            if (!due) continue;
            const result = await this.cancel(ctx, {
                orderId: order.id,
                expectedStatus: 'new',
                reason: 'unreachable',
                note: 'Cancelled automatically: the customer could not be reached',
            });
            if (isGraphQlErrorResult(result)) {
                Logger.warn(`Auto-cancel skipped order ${order.id}: ${result.reason}`, loggerCtx);
            } else {
                cancelled++;
            }
        }
        return cancelled;
    }

    /**
     * Locks the order, checks it is still what the staff member saw and that the action fits its
     * status, then runs the action. A refusal rolls the whole action back.
     */
    private async act(
        ctx: RequestContext,
        input: OrderActionInput,
        action: BdOrderAction | null,
        work: (txCtx: RequestContext, order: Order) => Promise<Order>,
    ): ActionResult {
        try {
            return await this.connection.withTransaction(ctx, async txCtx => {
                const locked = await this.connection
                    .getRepository(txCtx, Order)
                    .createQueryBuilder('order')
                    .setLock('pessimistic_write')
                    .where('order.id = :id', { id: input.orderId })
                    .getOne();
                if (!locked) {
                    throw refuse('ORDER_NOT_FOUND');
                }
                const status = bdStatusOf(locked.state);
                const order = await this.reload(txCtx, locked.id);
                if (input.expectedStatus && status !== input.expectedStatus) {
                    throw new Refusal(await this.changedError(txCtx, order, 'ALREADY_CHANGED'));
                }
                if (action) {
                    const { skipConfirmationForPrepaid } = await this.settings.get(txCtx);
                    const prepaid = bdPaymentType(order.totalWithTax, settledAmount(order)) === 'prepaid';
                    if (!bdActionsFor(status, { prepaid, skipConfirmationForPrepaid }).includes(action)) {
                        throw new Refusal(await this.changedError(txCtx, order, 'NOT_ALLOWED'));
                    }
                }
                return work(txCtx, order);
            });
        } catch (error) {
            if (error instanceof Refusal) {
                return error.result;
            }
            throw error;
        }
    }

    /** The error for an order that isn't where the staff member expected, with who changed it last. */
    private async changedError(
        ctx: RequestContext,
        order: Order,
        code: 'ALREADY_CHANGED' | 'NOT_ALLOWED',
    ): Promise<BdOrderActionError> {
        const last = await this.connection.getRepository(ctx, OrderHistoryEntry).findOne({
            where: { order: { id: order.id }, type: STATE_TRANSITION },
            relations: { administrator: true },
            order: { createdAt: 'DESC', id: 'DESC' },
        });
        const administrator = last?.administrator;
        return new BdOrderActionError(code, {
            currentStatus: bdStatusOf(order.state),
            changedBy: administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : null,
            changedAt: last?.createdAt ?? null,
        });
    }

    private async transition(ctx: RequestContext, orderId: ID, state: string): Promise<Order> {
        const result = await this.orderService.transitionToState(ctx, orderId, state as never);
        if (isGraphQlErrorResult(result)) {
            throw refuse('NOT_ALLOWED', [result.transitionError ?? result.message]);
        }
        return this.reload(ctx, orderId);
    }

    /** Products in this order whose stock no longer covers what's been ordered (stock changed since). */
    private async stockShortages(ctx: RequestContext, order: Order): Promise<string[]> {
        const short: string[] = [];
        for (const line of order.lines.filter(candidate => candidate.quantity > 0)) {
            const saleable = await this.productVariantService.getSaleableStockLevel(ctx, line.productVariant);
            if (saleable < 0) {
                short.push(line.productVariant.name);
            }
        }
        return short;
    }

    private async updateFields(
        ctx: RequestContext,
        orderId: ID,
        customFields: Partial<Order['customFields']>,
    ) {
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update(Order)
            .set({ customFields } as never)
            .where('id = :id', { id: orderId })
            .execute();
    }

    private async reload(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'lines',
            'lines.productVariant',
            'shippingLines',
            'payments',
            'payments.refunds',
        ]);
        if (!order) {
            throw refuse('ORDER_NOT_FOUND');
        }
        return order;
    }
}

/**
 * Money received for the order and kept: settled payments minus settled refunds (phase 08). A
 * mobile banking payment still waiting for staff to check it doesn't count.
 */
export function settledAmount(order: Pick<Order, 'payments'>): number {
    return (order.payments ?? [])
        .filter(payment => payment.state === 'Settled')
        .reduce((sum, payment) => {
            const refunded = (payment.refunds ?? [])
                .filter(refund => refund.state === 'Settled')
                .reduce((total, refund) => total + refund.total, 0);
            return sum + payment.amount - refunded;
        }, 0);
}

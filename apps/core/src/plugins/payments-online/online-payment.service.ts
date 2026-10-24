import {
    isPlaceholderEmail,
    nextReconcileDelayMs,
    ONLINE_PAYMENT_LIMITS,
    type OnlineGateway,
    redactObject,
    sslcommerzSignatureValid,
} from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    AdministratorService,
    HistoryService,
    type ID,
    isGraphQlErrorResult,
    Logger,
    Order,
    OrderService,
    Payment,
    PaymentService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, LessThanOrEqual } from 'typeorm';
import { StoreSettingsService } from '../bd-core';
import { OrderActionsService } from '../bd-orders';
import { TrackingService } from '../bd-tracking';
import { type AttemptEvent, BdPaymentAttempt } from './attempt.entity';
import { loggerCtx, ONLINE_PAYMENT_HISTORY_TYPE, PAY_ROUTE, PAYMENTS_ONLINE_OPTIONS } from './constants';
import { bkashDriver } from './drivers/bkash';
import { sslcommerzDriver } from './drivers/sslcommerz';
import type { GatewayOutcome } from './drivers/types';
import { GatewayService } from './gateway.service';
import { OnlineSettingsService } from './online-settings.service';
import { keepsWaiting } from './order-operations';
import type { OnlinePaymentMetadata, PaymentsOnlinePluginOptions } from './types';

/** Where the shopper lands after the gateway: the order's tracking page with what happened. */
export type PaymentResult =
    'paid' | 'pending' | 'failed' | 'cancelled' | 'unavailable' | 'expired' | 'limit' | 'review';

export type ReviewAction = 'accept' | 'refund' | 'resolve';

export type ReviewError =
    'NOT_FOUND' | 'NOT_OPEN' | 'NOT_RISKY' | 'NOTE_REQUIRED' | 'REFUND_FAILED' | 'UNAVAILABLE';

export class OnlinePaymentError extends Error {
    constructor(
        readonly code: ReviewError,
        message?: string,
    ) {
        super(message ?? code);
    }
}

const OPEN = ['created', 'started'] as const;
const MAX_EVENTS = 30;
const UNIQUE_VIOLATION = '23505';
const MINUTE = 60_000;

/** A new attempt key: 32 hex characters (128 bits), our tran_id and the key in the pay link. */
export const newAttemptToken = () => randomBytes(16).toString('hex');

/**
 * Online payments (roadmap phase 18). An attempt is one try at paying a Pending payment. Whatever
 * the gateway says (IPN, return post, callback, a query) goes through `apply`, which locks the
 * attempt and settles the payment at most once; money that can't go to the order (late, a second
 * payment, risky, wrong amount) is held for staff in the review queue. Nothing the shopper's browser
 * brings back is trusted: every "paid" comes from a server-to-server answer.
 */
@Injectable()
export class OnlinePaymentService {
    constructor(
        @Inject(PAYMENTS_ONLINE_OPTIONS) private options: PaymentsOnlinePluginOptions,
        private connection: TransactionalConnection,
        private gateways: GatewayService,
        private settings: OnlineSettingsService,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private historyService: HistoryService,
        private requestContextService: RequestContextService,
        private administrators: AdministratorService,
        private tracking: TrackingService,
        private orderActions: OrderActionsService,
        private moduleRef: ModuleRef,
    ) {}

    /** From bd-core, found like Vendure's own injector does (any module). */
    private get storeSettings() {
        return this.moduleRef.get(StoreSettingsService, { strict: false });
    }

    /**
     * The storefront's address in the shopper's language: the store's default language has no prefix,
     * the other is under /en or /bn (phase 12's URLs).
     */
    private async storefrontBase(ctx: RequestContext, order: Order): Promise<string> {
        const locale = (order.customFields as { locale?: string | null }).locale;
        const { locale: store } = await this.storeSettings.get(ctx);
        const prefix =
            locale && (locale === 'en' || locale === 'bn') && locale !== store.defaultLanguage
                ? `/${locale}`
                : '';
        return `${this.publicUrl ?? ''}${prefix}`;
    }

    /** The store's public address (STOREFRONT_URL), without a trailing slash; null when not set. */
    get publicUrl(): string | null {
        return this.options.publicUrl ? this.options.publicUrl.replace(/\/$/, '') : null;
    }

    payUrl(token: string): string {
        return `${this.publicUrl ?? ''}/${PAY_ROUTE}/start/${token}`;
    }

    /** Trusted server work: no request, no user (the gateways' calls, the scheduled tasks). */
    background(): Promise<RequestContext> {
        return this.requestContextService.create({ apiType: 'admin' });
    }

    /** The payment just became Pending: write its first attempt (same transaction). */
    async recordFirstAttempt(ctx: RequestContext, payment: Payment, order: Order) {
        const metadata = payment.metadata as OnlinePaymentMetadata;
        const mode = (await this.settings.get(ctx))[metadata.gateway].mode;
        await this.connection.getRepository(ctx, BdPaymentAttempt).save(
            new BdPaymentAttempt({
                token: metadata.firstAttemptToken,
                orderId: order.id,
                paymentId: payment.id,
                gateway: metadata.gateway,
                mode,
                amount: payment.amount,
                status: 'created',
                nextCheckAt: new Date(Date.now() + 5 * MINUTE),
                events: [],
            }),
        );
    }

    // ── The shopper's way through ────────────────────────────────────────────────────────────

    /**
     * `/bd-pay/start/<token>`: starts the attempt at the gateway and returns where to send the
     * shopper. An attempt already started (back button, a reload) gets a fresh one.
     */
    async start(token: string): Promise<string> {
        const ctx = await this.background();
        const attempt = await this.attemptByToken(ctx, token);
        if (!attempt) return this.homeUrl();
        const order = await this.orderService.findOne(ctx, attempt.orderId);
        if (!order) return this.homeUrl();
        if (attempt.status === 'paid') return this.resultUrl(ctx, order, 'paid');
        const payment = await this.connection
            .getRepository(ctx, Payment)
            .findOne({ where: { id: attempt.paymentId } });
        if (order.state !== 'AwaitingPayment' || payment?.state !== 'Pending') {
            return this.resultUrl(ctx, order, order.state === 'Cancelled' ? 'expired' : 'paid');
        }
        const current = attempt.status === 'created' ? attempt : await this.newAttempt(ctx, attempt, order);
        if (!current) return this.resultUrl(ctx, order, 'limit');
        return this.startAtGateway(ctx, current, order);
    }

    /**
     * "Pay now" on the tracking page: a new attempt for an order still waiting for its payment.
     * Returns the storefront's pay page for it.
     */
    async payAgain(trackingToken: string): Promise<string> {
        const ctx = await this.background();
        if (!/^[A-Za-z0-9_-]{20,32}$/.test(trackingToken)) return this.homeUrl();
        const found = await this.connection.getRepository(ctx, Order).findOne({
            where: { customFields: { trackingToken } },
            select: { id: true },
        });
        // With its lines, customer and address: the gateway gets them.
        const order = found && (await this.orderService.findOne(ctx, found.id));
        if (!order) return this.homeUrl();
        if (order.state !== 'AwaitingPayment')
            return this.resultUrl(ctx, order, order.state === 'Cancelled' ? 'expired' : 'paid');
        const latest = await this.connection.getRepository(ctx, BdPaymentAttempt).findOne({
            where: { orderId: order.id },
            order: { id: 'DESC' },
        });
        if (!latest) return this.resultUrl(ctx, order, 'failed');
        const payment = await this.connection
            .getRepository(ctx, Payment)
            .findOne({ where: { id: latest.paymentId } });
        if (payment?.state !== 'Pending') return this.resultUrl(ctx, order, 'paid');
        if (latest.reviewState === 'open') return this.resultUrl(ctx, order, 'review');
        const attempt = latest.status === 'created' ? latest : await this.newAttempt(ctx, latest, order);
        if (!attempt) return this.resultUrl(ctx, order, 'limit');
        // Through the storefront's pay page: a form may only redirect within the store (CSP
        // form-action), so the gateway is reached by a plain link from there (/bd-pay/start).
        return `${await this.storefrontBase(ctx, order)}/checkout/pay/?to=${attempt.token}`;
    }

    private async newAttempt(
        ctx: RequestContext,
        from: BdPaymentAttempt,
        order: Order,
    ): Promise<BdPaymentAttempt | null> {
        const repository = this.connection.getRepository(ctx, BdPaymentAttempt);
        if (
            (await repository.count({ where: { orderId: order.id } })) >=
            ONLINE_PAYMENT_LIMITS.attemptsPerOrder
        ) {
            return null;
        }
        // The same gateway and mode as the payment's first attempt.
        return repository.save(
            new BdPaymentAttempt({
                token: newAttemptToken(),
                orderId: order.id,
                paymentId: from.paymentId,
                gateway: from.gateway,
                mode: from.mode,
                amount: from.amount,
                status: 'created',
                nextCheckAt: new Date(Date.now() + 5 * MINUTE),
                events: [],
            }),
        );
    }

    private async startAtGateway(
        ctx: RequestContext,
        attempt: BdPaymentAttempt,
        order: Order,
    ): Promise<string> {
        const handle = await this.gateways.handleFor(ctx, attempt.gateway, attempt.mode);
        if (!handle || !this.publicUrl || this.gateways.paused(attempt.gateway, attempt.mode)) {
            return this.resultUrl(ctx, order, 'unavailable');
        }
        const base = `${this.publicUrl}/${PAY_ROUTE}`;
        const address = order.shippingAddress ?? {};
        const email = order.customer?.emailAddress;
        try {
            const started = await handle.driver.start(handle.call, {
                token: attempt.token,
                amount: attempt.amount,
                orderCode: order.customFields.orderNumber ?? order.code,
                urls: {
                    success: `${base}/sslcommerz/return/${attempt.token}/success`,
                    fail: `${base}/sslcommerz/return/${attempt.token}/fail`,
                    cancel: `${base}/sslcommerz/return/${attempt.token}/cancel`,
                    ipn: `${base}/sslcommerz/ipn`,
                    callback: `${base}/bkash/callback/${attempt.token}`,
                },
                customer: {
                    name: address.fullName || 'Customer',
                    phone: address.phoneNumber || order.customer?.phoneNumber || '',
                    // Phone-only customers have a placeholder email: never sent to a gateway.
                    email:
                        email && !isPlaceholderEmail(email)
                            ? email
                            : `orders@${new URL(this.publicUrl).hostname}`,
                    address: address.streetLine1 || address.city || 'Bangladesh',
                    city: address.city || address.province || 'Dhaka',
                },
                items: {
                    count: order.lines.reduce((sum, line) => sum + line.quantity, 0),
                    names: order.lines
                        .map(line => line.productVariant?.name ?? '')
                        .filter(Boolean)
                        .join(', '),
                },
            });
            await this.connection.getRepository(ctx, BdPaymentAttempt).update(attempt.id, {
                status: 'started',
                gatewaySessionId: started.sessionId || null,
                nextCheckAt: new Date(Date.now() + 5 * MINUTE),
                events: withEvent(attempt.events, 'start', 'started', started.raw),
            });
            return started.redirectUrl;
        } catch (error) {
            this.gateways.noteFailure(attempt.gateway, attempt.mode, error);
            await this.connection.getRepository(ctx, BdPaymentAttempt).update(attempt.id, {
                status: 'failed',
                failureCode: 'unavailable',
                nextCheckAt: null,
                events: withEvent(attempt.events, 'start', 'error', { message: String(error) }),
            });
            return this.resultUrl(ctx, order, 'unavailable');
        }
    }

    // ── What the gateways tell us ────────────────────────────────────────────────────────────

    /**
     * An SSLCommerz IPN (server to server) or a return post (through the shopper's browser). Neither is
     * trusted as it stands: a `val_id` is checked with the validation API; without one (or with a bad
     * signature) the transaction is looked up by our tran_id. Returns where to send a returning shopper.
     */
    async sslcommerzNotification(
        fields: Record<string, unknown>,
        source: 'ipn' | 'return',
        tokenFromUrl?: string,
    ): Promise<string> {
        const ctx = await this.background();
        const token = typeof fields.tran_id === 'string' ? fields.tran_id : tokenFromUrl;
        const attempt = token ? await this.attemptByToken(ctx, token) : null;
        // A return post must be about the attempt in its own URL.
        if (
            !attempt ||
            attempt.gateway !== 'sslcommerz' ||
            (tokenFromUrl && attempt.token !== tokenFromUrl)
        ) {
            Logger.warn(`SSLCommerz ${source} for an unknown transaction, ignored`, loggerCtx);
            return this.homeUrl();
        }
        const order = await this.orderService.findOne(ctx, attempt.orderId);
        const handle = await this.gateways.handleFor(ctx, 'sslcommerz', attempt.mode);
        if (!order || !handle) return order ? this.resultUrl(ctx, order, 'pending') : this.homeUrl();
        await this.addEvent(ctx, attempt, source, String(fields.status ?? ''), fields);
        const valId =
            typeof fields.val_id === 'string' && /^[\w-]{1,100}$/.test(fields.val_id) ? fields.val_id : null;
        const signed = sslcommerzSignatureValid(fields, handle.call.credentials.storePassword ?? '');
        if (!signed && fields.verify_sign) {
            Logger.warn(
                `SSLCommerz ${source} with a bad signature for attempt ${attempt.id}; asking the gateway`,
                loggerCtx,
            );
        }
        let outcome: GatewayOutcome;
        try {
            outcome =
                valId && signed
                    ? await sslcommerzDriver.validate(handle.call, valId)
                    : await sslcommerzDriver.query(handle.call, attempt);
        } catch (error) {
            this.gateways.noteFailure('sslcommerz', attempt.mode, error);
            return this.resultUrl(ctx, order, 'pending');
        }
        const result = await this.apply(ctx, attempt.id, outcome, valId && signed ? 'validate' : 'query');
        return this.resultUrl(ctx, order, result, outcome.failureCode);
    }

    /**
     * bKash's callback (`?paymentID=…&status=success|failure|cancel`) through the shopper's browser.
     * On success we execute (and query when execute fails); otherwise we ask bKash what happened.
     */
    async bkashCallback(
        token: string,
        paymentId: string | undefined,
        status: string | undefined,
    ): Promise<string> {
        const ctx = await this.background();
        const attempt = await this.attemptByToken(ctx, token);
        if (!attempt || attempt.gateway !== 'bkash') return this.homeUrl();
        const order = await this.orderService.findOne(ctx, attempt.orderId);
        if (!order) return this.homeUrl();
        if (!paymentId || paymentId !== attempt.gatewaySessionId) {
            Logger.warn(
                `bKash callback with a paymentID that isn't attempt ${attempt.id}'s, ignored`,
                loggerCtx,
            );
            return this.resultUrl(ctx, order, 'pending');
        }
        const handle = await this.gateways.handleFor(ctx, 'bkash', attempt.mode);
        if (!handle) return this.resultUrl(ctx, order, 'pending');
        await this.addEvent(ctx, attempt, 'callback', String(status ?? ''), { paymentID: paymentId, status });
        let outcome: GatewayOutcome;
        try {
            outcome =
                status === 'success'
                    ? await bkashDriver.execute(handle.call, attempt)
                    : await bkashDriver.query(handle.call, attempt);
        } catch (error) {
            this.gateways.noteFailure('bkash', attempt.mode, error);
            return this.resultUrl(ctx, order, 'pending');
        }
        // The shopper cancelled or bKash refused, and bKash agrees the payment didn't complete.
        if (status === 'cancel' && outcome.outcome === 'pending')
            outcome = { ...outcome, outcome: 'cancelled' };
        const result = await this.apply(ctx, attempt.id, outcome, status === 'success' ? 'execute' : 'query');
        return this.resultUrl(ctx, order, result, outcome.failureCode);
    }

    /** "Check status now" (staff) and the reconciliation task: ask the gateway, apply the answer. */
    async check(ctx: RequestContext, attemptId: ID): Promise<BdPaymentAttempt | null> {
        const attempt = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .findOne({ where: { id: attemptId } });
        if (!attempt) return null;
        if (attempt.status === 'created' || (!attempt.gatewaySessionId && attempt.gateway === 'bkash')) {
            return this.reschedule(ctx, attempt);
        }
        const handle = await this.gateways.handleFor(ctx, attempt.gateway, attempt.mode);
        if (!handle) return this.reschedule(ctx, attempt);
        try {
            const outcome = await handle.driver.query(handle.call, attempt);
            await this.apply(ctx, attempt.id, outcome, 'query');
        } catch (error) {
            this.gateways.noteFailure(attempt.gateway, attempt.mode, error);
            await this.reschedule(ctx, attempt);
        }
        return this.connection.getRepository(ctx, BdPaymentAttempt).findOne({ where: { id: attemptId } });
    }

    private async reschedule(ctx: RequestContext, attempt: BdPaymentAttempt): Promise<BdPaymentAttempt> {
        const delay = nextReconcileDelayMs(Date.now() - attempt.createdAt.getTime());
        const changes: Partial<BdPaymentAttempt> = {
            checks: attempt.checks + 1,
            lastCheckedAt: new Date(),
            nextCheckAt: delay === null ? null : new Date(Date.now() + delay),
        };
        // A week without an answer: given up (a created attempt was never opened at all).
        if (delay === null) changes.status = 'expired';
        await this.connection.getRepository(ctx, BdPaymentAttempt).update(attempt.id, changes);
        return { ...attempt, ...changes } as BdPaymentAttempt;
    }

    /**
     * Applies a gateway's answer to an attempt, once: the attempt row is locked, a confirmed payment's
     * reference is unique, and the payment is settled only while it's still Pending.
     */
    async apply(
        ctx: RequestContext,
        attemptId: ID,
        outcome: GatewayOutcome,
        source: string,
    ): Promise<PaymentResult> {
        try {
            return await this.connection.withTransaction(ctx, txCtx =>
                this.applyLocked(txCtx, attemptId, outcome, source),
            );
        } catch (error) {
            if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
                // The same gateway payment was applied by a parallel notification.
                return 'paid';
            }
            throw error;
        }
    }

    private async applyLocked(
        ctx: RequestContext,
        attemptId: ID,
        outcome: GatewayOutcome,
        source: string,
    ): Promise<PaymentResult> {
        const repository = this.connection.getRepository(ctx, BdPaymentAttempt);
        const attempt = await repository
            .createQueryBuilder('attempt')
            .setLock('pessimistic_write')
            .where('attempt.id = :id', { id: attemptId })
            .getOne();
        if (!attempt) return 'failed';
        const events = withEvent(attempt.events, source, outcome.status, outcome.raw);
        const checked = { events, checks: attempt.checks + 1, lastCheckedAt: new Date() };

        if (attempt.status === 'paid') {
            await repository.update(attempt.id, checked);
            return attempt.reviewState ? 'review' : 'paid';
        }
        if (outcome.token && outcome.token !== attempt.token) {
            // An answer about another transaction: never applied here.
            Logger.warn(
                `Gateway answer for another transaction on attempt ${attempt.id}, ignored`,
                loggerCtx,
            );
            await repository.update(attempt.id, checked);
            return 'pending';
        }
        if (outcome.outcome === 'pending') {
            const delay = nextReconcileDelayMs(Date.now() - attempt.createdAt.getTime());
            await repository.update(attempt.id, {
                ...checked,
                nextCheckAt: delay === null ? null : new Date(Date.now() + delay),
            });
            return 'pending';
        }
        if (outcome.outcome === 'failed' || outcome.outcome === 'cancelled') {
            await repository.update(attempt.id, {
                ...checked,
                status: outcome.outcome,
                failureCode: outcome.failureCode ?? null,
                nextCheckAt: null,
            });
            await this.history(ctx, attempt, outcome.outcome, { reason: outcome.failureCode });
            return outcome.outcome;
        }

        // Paid. Record it first (the unique reference stops a second application), then decide.
        const paid: Partial<BdPaymentAttempt> = {
            ...checked,
            status: 'paid',
            gatewayReference: outcome.reference ?? `${attempt.gateway}:${attempt.token}`,
            gatewayTransactionId: outcome.transactionId ?? null,
            paidAmount: outcome.amount ?? null,
            paidAt: new Date(),
            nextCheckAt: null,
        };
        const payment = await this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('payment')
            .setLock('pessimistic_write')
            .where('payment.id = :id', { id: attempt.paymentId })
            .getOne();
        const review = (reason: BdPaymentAttempt['reviewReason']) => ({
            ...paid,
            reviewReason: reason,
            reviewState: 'open' as const,
        });

        if (outcome.amount !== attempt.amount || (outcome.currency ?? 'BDT').toUpperCase() !== 'BDT') {
            await repository.update(attempt.id, review('mismatch'));
            Logger.error(
                `Online payment for attempt ${attempt.id} has the wrong amount or currency; held for review`,
                loggerCtx,
            );
            await this.history(ctx, attempt, 'review', {
                reason: 'mismatch',
                amount: outcome.amount ?? undefined,
            });
            return 'review';
        }
        if (!payment || payment.state !== 'Pending') {
            const reason = payment?.state === 'Settled' ? 'duplicate' : 'late';
            await repository.update(attempt.id, review(reason));
            Logger.warn(
                `Online payment for attempt ${attempt.id} can't go to its order (${reason}); held for review`,
                loggerCtx,
            );
            await this.history(ctx, attempt, 'review', { reason, amount: attempt.amount });
            return reason === 'duplicate' ? 'paid' : 'review';
        }
        if (outcome.risky) {
            await repository.update(attempt.id, review('risky'));
            await this.history(ctx, attempt, 'review', { reason: 'risky', amount: attempt.amount });
            return 'review';
        }
        await repository.update(attempt.id, paid);
        await this.settle(ctx, payment, attempt, outcome.transactionId ?? null);
        return 'paid';
    }

    /** Settles the payment for this attempt; Vendure then moves the order on (to PaymentSettled or PaymentAuthorized). */
    private async settle(
        ctx: RequestContext,
        payment: Payment,
        attempt: BdPaymentAttempt,
        transactionId: string | null,
    ) {
        const metadata: OnlinePaymentMetadata = {
            ...(payment.metadata as OnlinePaymentMetadata),
            paidAttemptId: String(attempt.id),
            gatewayTransactionId: transactionId ?? undefined,
        };
        await this.connection.getRepository(ctx, Payment).update(payment.id, {
            metadata: metadata as never,
            transactionId: transactionId ?? undefined,
        });
        const result = await this.paymentService.settlePayment(ctx, payment.id);
        if (isGraphQlErrorResult(result) || result.state !== 'Settled') {
            throw new Error(`Could not settle payment ${payment.id}`);
        }
        // Other unfinished attempts of this payment can't pay it any more; any money from them is a duplicate.
        await this.history(ctx, attempt, 'paid', { amount: attempt.amount });
        const order = await this.orderService.findOne(ctx, attempt.orderId);
        if (order?.state === 'AwaitingPayment') {
            Logger.error(`Order ${order.id} is paid but still waiting for payment`, loggerCtx);
        }
    }

    // ── Scheduled work ────────────────────────────────────────────────────────────────────────

    /** Asks the gateways about every unfinished attempt that's due. Returns how many were checked. */
    async reconcile(limit = 100): Promise<number> {
        const ctx = await this.background();
        const due = await this.connection.getRepository(ctx, BdPaymentAttempt).find({
            where: { status: In([...OPEN]), nextCheckAt: LessThanOrEqual(new Date()) },
            order: { nextCheckAt: 'ASC' },
            take: limit,
        });
        for (const attempt of due) {
            await this.check(ctx, attempt.id).catch(error =>
                Logger.error(`Reconciling attempt ${attempt.id} failed: ${String(error)}`, loggerCtx),
            );
        }
        return due.length;
    }

    /**
     * Cancels unpaid online orders after the store's waiting time, releasing their stock. Each
     * unfinished attempt is asked about first, so a payment that arrived without a notification
     * still counts. Attempts keep being reconciled after this, so late money reaches the review queue.
     */
    async expire(): Promise<number> {
        const ctx = await this.background();
        const settings = await this.settings.get(ctx);
        const before = new Date(Date.now() - settings.expiryMinutes * MINUTE);
        const orders = await this.connection.getRepository(ctx, Order).find({
            select: { id: true },
            where: { state: 'AwaitingPayment', orderPlacedAt: LessThanOrEqual(before) },
            take: 100,
        });
        let cancelled = 0;
        for (const { id } of orders) {
            try {
                if (await this.expireOne(ctx, id, settings)) cancelled++;
            } catch (error) {
                Logger.error(`Could not expire order ${id}: ${String(error)}`, loggerCtx);
            }
        }
        return cancelled;
    }

    private async expireOne(
        ctx: RequestContext,
        orderId: ID,
        settings: Awaited<ReturnType<OnlineSettingsService['get']>>,
    ): Promise<boolean> {
        const attempts = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .find({ where: { orderId } });
        for (const attempt of attempts.filter(item => item.status === 'started')) {
            await this.check(ctx, attempt.id);
        }
        const fresh = await this.connection.getRepository(ctx, BdPaymentAttempt).find({ where: { orderId } });
        if (fresh.some(attempt => attempt.reviewState === 'open')) return false;
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        if (keepsWaiting(settings, payments)) return false;
        const order = await this.orderService.findOne(ctx, orderId);
        if (order?.state !== 'AwaitingPayment') return false;
        const result = await this.orderActions.cancel(ctx, {
            orderId,
            expectedStatus: 'awaitingPayment',
            reason: 'paymentNotReceived',
            note: 'Cancelled automatically: the online payment did not arrive in time',
        });
        if (isGraphQlErrorResult(result)) {
            Logger.warn(`Expiry skipped order ${orderId}: ${result.message}`, loggerCtx);
            return false;
        }
        // Nothing can pay the order any more: its pending and COD payments are cancelled too.
        for (const payment of payments.filter(
            item => item.state === 'Pending' || item.state === 'Authorized',
        )) {
            await this.orderService.cancelPayment(ctx, payment.id);
        }
        await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .update({ orderId, status: 'created' }, { status: 'expired', nextCheckAt: null });
        return true;
    }

    // ── Staff ─────────────────────────────────────────────────────────────────────────────────

    attemptsForOrder(ctx: RequestContext, orderId: ID): Promise<BdPaymentAttempt[]> {
        return this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .find({ where: { orderId }, order: { id: 'ASC' } });
    }

    reviews(ctx: RequestContext): Promise<BdPaymentAttempt[]> {
        return this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .find({ where: { reviewState: 'open' }, order: { paidAt: 'ASC' }, take: 200 });
    }

    /**
     * A decision on money held for review: accept (a risky payment that staff checked: it pays the
     * order), refund (back to the shopper through the gateway), or resolve (handled outside, with a note).
     */
    async review(
        ctx: RequestContext,
        attemptId: ID,
        action: ReviewAction,
        note?: string | null,
    ): Promise<BdPaymentAttempt> {
        const cleaned = (note ?? '').trim().slice(0, 500);
        if (action === 'resolve' && !cleaned) throw new OnlinePaymentError('NOTE_REQUIRED');
        const by = await this.staffName(ctx);
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, BdPaymentAttempt);
            const attempt = await repository
                .createQueryBuilder('attempt')
                .setLock('pessimistic_write')
                .where('attempt.id = :id', { id: attemptId })
                .getOne();
            if (!attempt) throw new OnlinePaymentError('NOT_FOUND');
            if (attempt.reviewState !== 'open') throw new OnlinePaymentError('NOT_OPEN');
            const decided = { reviewedBy: by, reviewedAt: new Date(), reviewNote: cleaned || null };
            if (action === 'accept') {
                if (attempt.reviewReason !== 'risky') throw new OnlinePaymentError('NOT_RISKY');
                const payment = await this.connection
                    .getRepository(txCtx, Payment)
                    .findOne({ where: { id: attempt.paymentId } });
                if (payment?.state !== 'Pending') throw new OnlinePaymentError('NOT_OPEN');
                await repository.update(attempt.id, { ...decided, reviewState: 'accepted' });
                await this.settle(txCtx, payment, attempt, attempt.gatewayTransactionId);
            } else if (action === 'refund') {
                const handle = await this.gateways.handleFor(txCtx, attempt.gateway, attempt.mode);
                if (!handle) throw new OnlinePaymentError('UNAVAILABLE');
                const refund = await handle.driver.refund(
                    handle.call,
                    attempt,
                    attempt.paidAmount ?? attempt.amount,
                    `Refund (${attempt.reviewReason})`,
                );
                await repository.update(attempt.id, {
                    events: withEvent(attempt.events, 'refund', refund.outcome, refund.raw),
                });
                if (refund.outcome === 'failed') {
                    throw new OnlinePaymentError('REFUND_FAILED', refund.message);
                }
                await repository.update(attempt.id, {
                    ...decided,
                    reviewState: 'refunded',
                    refundReference: refund.reference ?? null,
                    reviewNote:
                        cleaned ||
                        (refund.outcome === 'processing' ? 'Refund is processing at the gateway' : null),
                });
            } else {
                await repository.update(attempt.id, { ...decided, reviewState: 'resolved' });
            }
            await this.history(
                txCtx,
                attempt,
                action === 'accept' ? 'accepted' : action === 'refund' ? 'refunded' : 'resolved',
                {
                    amount: attempt.paidAmount ?? attempt.amount,
                    reason: attempt.reviewReason ?? undefined,
                    note: cleaned || undefined,
                },
            );
            return (await repository.findOne({ where: { id: attempt.id } }))!;
        });
    }

    async testConnection(ctx: RequestContext, gateway: OnlineGateway, mode: 'sandbox' | 'live') {
        const handle = await this.gateways.handleFor(ctx, gateway, mode);
        if (!handle) return { ok: false, message: 'Save all the credentials for this mode first' };
        return handle.driver.testConnection(handle.call);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    private attemptByToken(ctx: RequestContext, token: string) {
        if (!/^[a-f0-9]{32}$/.test(token)) return Promise.resolve(null);
        return this.connection.getRepository(ctx, BdPaymentAttempt).findOne({ where: { token } });
    }

    private homeUrl(): string {
        return `${this.publicUrl ?? ''}/`;
    }

    /** The order's tracking page, which shows what happened and, while it waits, "Pay now". */
    async resultUrl(
        ctx: RequestContext,
        order: Order,
        result: PaymentResult,
        reason?: string,
    ): Promise<string> {
        const token = await this.tracking.tokenFor(ctx, order);
        const query = new URLSearchParams({ payment: result });
        if (reason && /^[A-Za-z]{1,40}$/.test(reason)) query.set('reason', reason);
        return token ? `${await this.storefrontBase(ctx, order)}/t/${token}/?${query}` : this.homeUrl();
    }

    private async addEvent(
        ctx: RequestContext,
        attempt: BdPaymentAttempt,
        source: string,
        status: string,
        data: unknown,
    ) {
        attempt.events = withEvent(attempt.events, source, status, data);
        await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .update(attempt.id, { events: attempt.events });
    }

    private async history(
        ctx: RequestContext,
        attempt: BdPaymentAttempt,
        event: string,
        extra: { amount?: number; reason?: string; note?: string } = {},
    ) {
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: attempt.orderId,
            type: ONLINE_PAYMENT_HISTORY_TYPE,
            data: { attemptId: String(attempt.id), gateway: attempt.gateway, event, ...extra },
        });
    }

    private async staffName(ctx: RequestContext): Promise<string> {
        const administrator = ctx.activeUserId
            ? await this.administrators.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        return administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : 'system';
    }
}

/** Appends a gateway event with secrets and personal data removed; keeps the latest 30. */
function withEvent(
    events: AttemptEvent[] | null | undefined,
    source: string,
    status: string,
    data: unknown,
): AttemptEvent[] {
    const event: AttemptEvent = {
        at: new Date().toISOString(),
        source,
        status: status.slice(0, 40),
        data: JSON.stringify(redactObject(data) ?? null).slice(0, 4000),
    };
    const next = [...(events ?? []), event];
    return next.slice(-MAX_EVENTS);
}

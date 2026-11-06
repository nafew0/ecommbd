import {
    gatewayAcceptsAmount,
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
import { type BkashTransaction, bkashDriver } from './drivers/bkash';
import { sslcommerzDriver } from './drivers/sslcommerz';
import type { GatewayOutcome, RefundOutcome, RefundRefusal, RefundStatus } from './drivers/types';
import { GatewayService } from './gateway.service';
import { OnlineSettingsService } from './online-settings.service';
import { keepsWaiting } from './order-operations';
import type { OnlinePaymentMetadata, PaymentsOnlinePluginOptions } from './types';

/** Where the shopper lands after the gateway: the order's tracking page with what happened. */
export type PaymentResult =
    'paid' | 'pending' | 'failed' | 'cancelled' | 'unavailable' | 'expired' | 'limit' | 'review';

export type ReviewAction = 'accept' | 'refund' | 'resolve';

export type ReviewError =
    | 'NOT_FOUND'
    | 'NOT_OPEN'
    | 'NOT_RISKY'
    | 'NOTE_REQUIRED'
    | 'REFUND_FAILED'
    | 'REFUND_UNKNOWN'
    | 'REFUND_NO_TRANSACTION'
    | 'REFUND_TOO_LATE'
    | 'REFUND_TOO_MUCH'
    | 'REFUND_TOO_SOON'
    | 'REFUND_LIMIT'
    | 'UNAVAILABLE'
    | 'NO_TRANSACTION';

/** A driver's refusal code as the error staff see (translated in i18n.ts). */
const REFUSAL_ERRORS: Record<RefundRefusal, ReviewError> = {
    noTransaction: 'REFUND_NO_TRANSACTION',
    tooLate: 'REFUND_TOO_LATE',
    tooMuch: 'REFUND_TOO_MUCH',
    tooSoon: 'REFUND_TOO_SOON',
    tooMany: 'REFUND_LIMIT',
    refused: 'REFUND_FAILED',
};

export class OnlinePaymentError extends Error {
    constructor(
        readonly code: ReviewError,
        message?: string,
    ) {
        super(message ?? code);
    }
}

/**
 * Attempts the reconciliation task asks about while they have a `nextCheckAt`: unfinished ones, and
 * failed ones whose failure was ambiguous (the gateway may still finish them late).
 */
const RECONCILED = ['created', 'started', 'failed'] as const;
const MAX_EVENTS = 30;
const UNIQUE_VIOLATION = '23505';
const MINUTE = 60_000;

/**
 * A reload of the pay link within this time goes back to the same gateway page instead of opening a
 * new attempt: well inside how long the gateways keep a payment page open.
 */
const REUSE_PAGE_MS = 10 * MINUTE;
/**
 * How long a second `/bd-pay/start` waits for a parallel one to get the gateway's page (bKash may
 * take its full 30 seconds to answer).
 */
const START_WAIT_MS = 35_000;
const START_POLL_MS = 200;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A new attempt key: 30 hex characters (120 bits), our tran_id and the key in the pay link.
 * SSLCommerz takes a tran_id of at most 30; attempts made before that change have 32.
 */
export const newAttemptToken = () => randomBytes(15).toString('hex');
const ATTEMPT_TOKEN = /^[a-f0-9]{30}(?:[a-f0-9]{2})?$/;

/** Our ID for one refund request (SSLCommerz refund_trans_id, at most 30 characters). */
const newRefundId = () => randomBytes(15).toString('hex');

/** SSLCommerz takes a cus_email of at most 50 characters. */
const MAX_GATEWAY_EMAIL = 50;

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
     * shopper. Each attempt is started once: the pay page's instant refresh, its button and a reload
     * can all arrive together, so `created → started` is claimed by one request and the others go to
     * the page it gets. An attempt started a while ago (or one that ended) gets a fresh attempt.
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
        // The payment's newest try: an older pay link (a reload after a fresh try) goes there too.
        const latest =
            (await this.connection.getRepository(ctx, BdPaymentAttempt).findOne({
                where: { paymentId: attempt.paymentId },
                order: { id: 'DESC' },
            })) ?? attempt;
        if (latest.status === 'created' && (await this.claimStart(ctx, latest.id))) {
            return this.startAtGateway(ctx, latest, order);
        }
        if (latest.status === 'created' || latest.status === 'started') {
            const page = await this.startedPage(ctx, latest.id);
            if (page === 'unavailable') return this.resultUrl(ctx, order, 'unavailable');
            if (page) return page;
        }
        const fresh = await this.newAttempt(ctx, latest, order);
        if (!fresh) return this.resultUrl(ctx, order, 'limit');
        // Known to no one else yet, so the claim can't be lost; it records when it was started.
        await this.claimStart(ctx, fresh.id);
        return this.startAtGateway(ctx, fresh, order);
    }

    /** Claims `created → started` for this request; false when another one claimed it first. */
    private async claimStart(ctx: RequestContext, attemptId: ID): Promise<boolean> {
        const result = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .createQueryBuilder()
            .update()
            .set({ status: 'started', startedAt: new Date() })
            .where('id = :id', { id: attemptId })
            .andWhere('status = :created', { created: 'created' })
            .execute();
        return result.affected === 1;
    }

    /**
     * The gateway page of an attempt another request started: waited for while that start is still
     * talking to the gateway; reused while recent. `unavailable` when that start just failed; null
     * when there's nothing to reuse (the caller opens a new attempt).
     */
    private async startedPage(ctx: RequestContext, attemptId: ID): Promise<string | 'unavailable' | null> {
        const repository = this.connection.getRepository(ctx, BdPaymentAttempt);
        for (;;) {
            const current = await repository.findOne({ where: { id: attemptId } });
            // The other request gave its claim back: the gateway can't be used right now.
            if (current?.status === 'created') return 'unavailable';
            // Attempts started before startedAt existed: nothing known to reuse.
            if (!current?.startedAt) return null;
            const age = Date.now() - current.startedAt.getTime();
            if (current.status === 'started' && current.gatewayRedirectUrl) {
                // Not after bKash's Execute: that paymentID can't be paid again.
                return age < REUSE_PAGE_MS && !current.executeSentAt ? current.gatewayRedirectUrl : null;
            }
            if (current.status === 'failed' && current.failureCode === 'unavailable' && age < START_WAIT_MS) {
                return 'unavailable';
            }
            // Still being started by the other request (unless it died on the way: then a new attempt).
            if (current.status !== 'started' || age >= START_WAIT_MS) return null;
            await sleep(START_POLL_MS);
        }
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
        if (
            !handle ||
            !this.publicUrl ||
            this.gateways.paused(attempt.gateway, attempt.mode) ||
            !gatewayAcceptsAmount(attempt.gateway, attempt.amount)
        ) {
            // Nothing was sent: the claim is given back, so the attempt can be started later.
            await this.connection
                .getRepository(ctx, BdPaymentAttempt)
                .update(attempt.id, { status: 'created', startedAt: null });
            return this.resultUrl(ctx, order, 'unavailable');
        }
        const base = `${this.publicUrl}/${PAY_ROUTE}`;
        const address = order.shippingAddress ?? {};
        const email = order.customer?.emailAddress;
        // Phone-only customers have a placeholder email: never sent to a gateway. Nor is one too long for it.
        const usableEmail =
            email && !isPlaceholderEmail(email) && email.length <= MAX_GATEWAY_EMAIL ? email : null;
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
                    email:
                        usableEmail ??
                        `orders@${new URL(this.publicUrl).hostname}`.slice(0, MAX_GATEWAY_EMAIL),
                    address: address.streetLine1 || address.city || 'Bangladesh',
                    city: address.city || address.province || 'Dhaka',
                    // SSLCommerz requires one; checkout doesn't ask for it (not used for delivery): Dhaka GPO.
                    postcode: address.postalCode?.trim() || '1000',
                },
                items: {
                    count: order.lines.reduce((sum, line) => sum + line.quantity, 0),
                    names: order.lines
                        .map(line => line.productVariant?.name ?? '')
                        .filter(Boolean)
                        .join(', '),
                },
            });
            await this.record(ctx, attempt.id, ['start', 'started', started.raw], {
                gatewaySessionId: started.sessionId || null,
                gatewaySignature: started.signature?.slice(0, 255) ?? null,
                gatewayRedirectUrl: started.redirectUrl,
                nextCheckAt: new Date(Date.now() + 5 * MINUTE),
            });
            return started.redirectUrl;
        } catch (error) {
            this.gateways.noteFailure(attempt.gateway, attempt.mode, error);
            // The shopper never got a payment page, so nothing can be paid: no need to reconcile.
            await this.record(ctx, attempt.id, ['start', 'error', { message: String(error) }], {
                status: 'failed',
                failureCode: 'unavailable',
                nextCheckAt: null,
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
        let checkedBy = valId && signed ? 'validate' : 'query';
        try {
            outcome =
                valId && signed
                    ? await sslcommerzDriver.validate(handle.call, valId)
                    : await sslcommerzDriver.query(handle.call, attempt);
            if (checkedBy === 'validate' && outcome.status === 'INVALID_TRANSACTION') {
                // Validation didn't know this val_id: that ends nothing, our tran_id may still be paid.
                await this.addEvent(ctx, attempt, 'validate', outcome.status, outcome.raw);
                outcome = await sslcommerzDriver.query(handle.call, attempt);
                checkedBy = 'query';
            }
        } catch (error) {
            this.gateways.noteFailure('sslcommerz', attempt.mode, error);
            return this.resultUrl(ctx, order, 'pending');
        }
        const result = await this.apply(ctx, attempt.id, outcome, checkedBy);
        return this.resultUrl(ctx, order, result, outcome.failureCode);
    }

    /**
     * bKash's callback (`?paymentID=…&status=success|failure|cancel&signature=…`) through the shopper's
     * browser. Only a callback with the attempt's paymentID and signature can execute, and Execute is
     * sent once per paymentID (a second callback or the reconciliation task only queries). A failure
     * or a cancel that bKash's query confirms ends the try, so the shopper sees "Pay again".
     */
    async bkashCallback(
        token: string,
        paymentId: string | undefined,
        status: string | undefined,
        signature?: string,
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
        // Attempts made before bKash v2 have no signature to compare.
        const signed = !attempt.gatewaySignature || signature === attempt.gatewaySignature;
        if (!signed) {
            Logger.warn(
                `bKash callback with a signature that isn't attempt ${attempt.id}'s: not executed, asking bKash`,
                loggerCtx,
            );
        }
        await this.addEvent(ctx, attempt, 'callback', String(status ?? ''), {
            paymentID: paymentId,
            status,
            signed,
        });
        const execute = status === 'success' && signed && (await this.claimExecute(ctx, attempt));
        let outcome: GatewayOutcome;
        try {
            outcome = execute
                ? await bkashDriver.execute(handle.call, attempt)
                : await bkashDriver.query(handle.call, attempt);
        } catch (error) {
            this.gateways.noteFailure('bkash', attempt.mode, error);
            return this.resultUrl(ctx, order, 'pending');
        }
        // The shopper cancelled or bKash refused, and bKash's query agrees it didn't complete:
        // "Initiated" then never completes (bKash: start a new payment).
        if (signed && outcome.outcome === 'pending' && (status === 'cancel' || status === 'failure')) {
            outcome = {
                ...outcome,
                outcome: status === 'cancel' ? 'cancelled' : 'failed',
                failureCode: status === 'failure' ? (outcome.failureCode ?? 'failed') : undefined,
            };
        }
        const result = await this.apply(ctx, attempt.id, outcome, execute ? 'execute' : 'query');
        return this.resultUrl(ctx, order, result, outcome.failureCode);
    }

    /** Marks Execute as sent for this attempt; false when it already was (by a parallel callback too). */
    private async claimExecute(ctx: RequestContext, attempt: BdPaymentAttempt): Promise<boolean> {
        const result = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .createQueryBuilder()
            .update()
            .set({ executeSentAt: new Date() })
            .where('id = :id', { id: attempt.id })
            .andWhere('"executeSentAt" IS NULL')
            .execute();
        return result.affected === 1;
    }

    /** "Look up transaction" for staff on a support call: what bKash says about the attempt's trxId. */
    async lookupBkash(ctx: RequestContext, attemptId: ID): Promise<BkashTransaction> {
        const attempt = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .findOne({ where: { id: attemptId } });
        if (!attempt) throw new OnlinePaymentError('NOT_FOUND');
        if (attempt.gateway !== 'bkash' || !attempt.gatewayTransactionId) {
            throw new OnlinePaymentError('NO_TRANSACTION');
        }
        const handle = await this.gateways.handleFor(ctx, 'bkash', attempt.mode);
        if (!handle) throw new OnlinePaymentError('UNAVAILABLE');
        return bkashDriver.search(handle.call, attempt.gatewayTransactionId);
    }

    /** "Check status now" (staff) and the reconciliation task: ask the gateway, apply the answer. */
    async check(ctx: RequestContext, attemptId: ID): Promise<BdPaymentAttempt | null> {
        const attempt = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .findOne({ where: { id: attemptId } });
        if (!attempt) return null;
        if (attempt.reviewState === 'refunding') return this.checkRefund(ctx, attempt.id);
        if (attempt.status === 'created' || (!attempt.gatewaySessionId && attempt.gateway === 'bkash')) {
            return this.reschedule(ctx, attempt);
        }
        const handle = await this.gateways.handleFor(ctx, attempt.gateway, attempt.mode);
        if (!handle) return this.reschedule(ctx, attempt);
        try {
            let outcome = await handle.driver.query(handle.call, attempt);
            // bKash: after an Execute, "Initiated" shouldn't complete any more (the paymentId can't be
            // used again), so the shopper is told it failed. bKash never said so, though: it stays
            // ambiguous and keeps being asked, in case its Execute finishes late.
            if (attempt.gateway === 'bkash' && attempt.executeSentAt && outcome.outcome === 'pending') {
                outcome = {
                    ...outcome,
                    outcome: 'failed',
                    failureCode: attempt.failureCode ?? outcome.failureCode ?? 'failed',
                    ambiguous: true,
                };
            }
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
        // A week without an answer: given up (a created attempt was never opened at all). A failed
        // one stays failed.
        if (delay === null && attempt.status !== 'failed') changes.status = 'expired';
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
        const delay = nextReconcileDelayMs(Date.now() - attempt.createdAt.getTime());
        const keepChecking = {
            ...checked,
            nextCheckAt: delay === null ? null : new Date(Date.now() + delay),
        };
        // SSLCommerz always names our tran_id in a real answer: one without it proves nothing.
        const tokenMissing =
            attempt.gateway === 'sslcommerz' && outcome.outcome !== 'pending' && !outcome.token;
        if ((outcome.token && outcome.token !== attempt.token) || tokenMissing) {
            // An answer about another transaction (or none): never applied here; reconciliation goes on.
            Logger.warn(
                `Gateway answer ${tokenMissing ? 'without a transaction' : 'for another transaction'} on attempt ${attempt.id}, ignored`,
                loggerCtx,
            );
            await repository.update(attempt.id, keepChecking);
            return 'pending';
        }
        if (outcome.outcome === 'pending') {
            await repository.update(attempt.id, keepChecking);
            return 'pending';
        }
        if (outcome.outcome === 'failed' || outcome.outcome === 'cancelled') {
            await repository.update(attempt.id, {
                ...checked,
                status: outcome.outcome,
                failureCode: outcome.failureCode ?? null,
                failureMessageEn: outcome.failureMessage?.en ?? null,
                failureMessageBn: outcome.failureMessage?.bn ?? null,
                // A clear refusal ends it; an ambiguous failure is asked about for the rest of the
                // reconciliation window, so a late success still pays the order (or goes to review).
                nextCheckAt: outcome.ambiguous ? keepChecking.nextCheckAt : null,
            });
            // Once per change: an ambiguous failure asked about again doesn't repeat it in the history.
            if (attempt.status !== outcome.outcome) {
                await this.history(ctx, attempt, outcome.outcome, { reason: outcome.failureCode });
            }
            return outcome.outcome;
        }

        // Paid. Record it first (the unique reference stops a second application), then decide.
        // The order is locked before the payment, in the same order as staff actions (OrderActionsService
        // locks the order, then cancelling it cancels this payment), so a cancel and a payment can't
        // cross: whichever comes second sees what the first did.
        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .setLock('pessimistic_write')
            .where('order.id = :id', { id: attempt.orderId })
            .getOne();
        const paid: Partial<BdPaymentAttempt> = {
            ...checked,
            status: 'paid',
            gatewayReference: outcome.reference ?? `${attempt.gateway}:${attempt.token}`,
            gatewayTransactionId: outcome.transactionId ?? null,
            paidAmount: outcome.amount ?? null,
            riskTitle: outcome.riskTitle ?? null,
            maxRefundableAmount: outcome.maxRefundable ?? outcome.amount ?? null,
            payerAccount: outcome.payerAccount ?? null,
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
        // A cancelled order never takes the money, even when its payment was left Pending (orders
        // cancelled by staff before their payments were cancelled with them): it's held as late.
        if (!payment || payment.state !== 'Pending' || !order || order.state === 'Cancelled') {
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
            where: { status: In([...RECONCILED]), nextCheckAt: LessThanOrEqual(new Date()) },
            order: { nextCheckAt: 'ASC' },
            take: limit,
        });
        // Refunds the gateway was still processing (reviewState refunding), until it says how they ended.
        const refunds = await this.connection.getRepository(ctx, BdPaymentAttempt).find({
            where: { reviewState: 'refunding', nextCheckAt: LessThanOrEqual(new Date()) },
            order: { nextCheckAt: 'ASC' },
            take: limit,
        });
        for (const attempt of [...due, ...refunds]) {
            await this.check(ctx, attempt.id).catch(error =>
                Logger.error(`Reconciling attempt ${attempt.id} failed: ${String(error)}`, loggerCtx),
            );
        }
        return due.length + refunds.length;
    }

    /**
     * Asks the gateway about a refund it was still processing, or whose answer never came: refunded
     * ends it, cancelled (or never arrived) puts the money back in Payment reviews for staff,
     * processing asks again later (for a week). The gateway is asked with no row locked; its answer
     * is applied under the lock, and only if nobody decided on the refund meanwhile.
     */
    private async checkRefund(ctx: RequestContext, attemptId: ID): Promise<BdPaymentAttempt | null> {
        const asked = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .findOne({ where: { id: attemptId } });
        if (!asked || asked.reviewState !== 'refunding') return asked;
        const handle = await this.gateways.handleFor(ctx, asked.gateway, asked.mode);
        let status: RefundStatus | null | undefined;
        if (handle) {
            try {
                status = await handle.driver.refundStatus(handle.call, asked, asked.refundReference);
            } catch (error) {
                this.gateways.noteFailure(asked.gateway, asked.mode, error);
            }
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, BdPaymentAttempt);
            const attempt = await repository
                .createQueryBuilder('attempt')
                .setLock('pessimistic_write')
                .where('attempt.id = :id', { id: attemptId })
                .getOne();
            // Decided meanwhile (staff marked it resolved, a parallel check finished it): this answer is old.
            if (attempt?.reviewState !== 'refunding' || attempt.refundTransId !== asked.refundTransId) {
                return attempt;
            }
            const since = (attempt.reviewedAt ?? attempt.createdAt).getTime();
            const delay = nextReconcileDelayMs(Date.now() - since);
            const later = {
                checks: attempt.checks + 1,
                lastCheckedAt: new Date(),
                // After a week staff check the gateway's panel (it stays in Payment reviews).
                nextCheckAt: delay === null ? null : new Date(Date.now() + delay),
            };
            if (status === undefined) {
                // No credentials, or no answer: asked again later.
                await repository.update(attempt.id, later);
                return { ...attempt, ...later } as BdPaymentAttempt;
            }
            if (status === null) {
                // The gateway can't be asked without its refund reference (SSLCommerz, after a lost
                // answer): staff check its panel and mark it resolved. Nothing more to ask.
                await repository.update(attempt.id, { ...later, nextCheckAt: null });
                return { ...attempt, ...later, nextCheckAt: null } as BdPaymentAttempt;
            }
            const events = withEvent(attempt.events, 'refund-query', status.outcome, status.raw);
            const reference = attempt.refundReference ?? status.reference ?? null;
            const extra = {
                amount: attempt.paidAmount ?? attempt.amount,
                reason: attempt.reviewReason ?? undefined,
            };
            if (status.outcome === 'processing') {
                await repository.update(attempt.id, { ...later, events, refundReference: reference });
            } else if (status.outcome === 'refunded') {
                await repository.update(attempt.id, {
                    ...later,
                    events,
                    reviewState: 'refunded',
                    refundReference: reference,
                    nextCheckAt: null,
                });
                await this.history(txCtx, attempt, 'refunded', extra);
            } else {
                // Cancelled by the gateway (or it never arrived): the money is still with the store, so
                // staff decide again; the order's history says why.
                await repository.update(attempt.id, {
                    ...later,
                    events,
                    reviewState: 'open',
                    refundReference: null,
                    refundTransId: null,
                    nextCheckAt: null,
                });
                await this.history(txCtx, attempt, 'refundCancelled', extra);
            }
            return repository.findOne({ where: { id: attempt.id } });
        });
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
        // Ambiguous failures too: bKash may have finished one late, and then the order is paid.
        const unfinished = attempts.filter(
            item => item.status === 'started' || (item.status === 'failed' && item.nextCheckAt),
        );
        for (const attempt of unfinished) {
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
        // Cancelling the order cancelled its pending online payments and unopened tries (the order
        // process). Nothing can pay it any more, so a COD payment still to collect is cancelled too.
        const remaining = await this.orderService.getOrderPayments(ctx, orderId);
        for (const payment of remaining.filter(
            item => item.state === 'Pending' || item.state === 'Authorized',
        )) {
            await this.orderService.cancelPayment(ctx, payment.id);
        }
        return true;
    }

    // ── Staff ─────────────────────────────────────────────────────────────────────────────────

    attemptsForOrder(ctx: RequestContext, orderId: ID): Promise<BdPaymentAttempt[]> {
        return this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .find({ where: { orderId }, order: { id: 'ASC' } });
    }

    reviews(ctx: RequestContext): Promise<BdPaymentAttempt[]> {
        return this.connection.getRepository(ctx, BdPaymentAttempt).find({
            where: { reviewState: In(['open', 'refunding']) },
            order: { paidAt: 'ASC' },
            take: 200,
        });
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
        const decided = { reviewedBy: by, reviewedAt: new Date(), reviewNote: cleaned || null };
        if (action === 'refund') return this.refund(ctx, attemptId, decided);
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, BdPaymentAttempt);
            const attempt = await this.locked(txCtx, attemptId);
            if (!attempt) throw new OnlinePaymentError('NOT_FOUND');
            // A refund still processing can only be marked resolved (staff saw it in the gateway's panel).
            const open =
                attempt.reviewState === 'open' ||
                (attempt.reviewState === 'refunding' && action === 'resolve');
            if (!open) throw new OnlinePaymentError('NOT_OPEN');
            if (action === 'accept') {
                if (attempt.reviewReason !== 'risky') throw new OnlinePaymentError('NOT_RISKY');
                const payment = await this.connection
                    .getRepository(txCtx, Payment)
                    .findOne({ where: { id: attempt.paymentId } });
                // A cancelled order cancelled its payment too: the money can only be refunded now.
                if (payment?.state !== 'Pending') throw new OnlinePaymentError('NOT_OPEN');
                await repository.update(attempt.id, { ...decided, reviewState: 'accepted' });
                await this.settle(txCtx, payment, attempt, attempt.gatewayTransactionId);
            } else {
                await repository.update(attempt.id, {
                    ...decided,
                    reviewState: 'resolved',
                    nextCheckAt: null,
                });
            }
            await this.history(txCtx, attempt, action === 'accept' ? 'accepted' : 'resolved', {
                amount: attempt.paidAmount ?? attempt.amount,
                reason: attempt.reviewReason ?? undefined,
                note: cleaned || undefined,
            });
            return (await repository.findOne({ where: { id: attempt.id } }))!;
        });
    }

    /**
     * Refunds a held payment through the gateway, in three steps so no row stays locked while the
     * gateway answers (bKash may take 30 seconds, twice):
     *
     * 1. Under the lock, the refund is claimed: the attempt becomes `refunding` (nobody accepts or
     *    refunds it meanwhile) with our refund ID, and a check is scheduled in case we never finish.
     * 2. The gateway is asked, no lock held.
     * 3. Under the lock again, its answer is recorded: refunded; processing (asked about until it
     *    ends); refused (back to `open`, a retry is a new refund); or no answer at all. With no
     *    answer the refund may have gone through, so it is never shown as refused: it stays
     *    `refunding` and is checked with the gateway (bKash's Refund Status; SSLCommerz can't be asked
     *    without its reference, so staff check its panel). Never refunded twice.
     *
     * Every try is logged on the attempt.
     */
    private async refund(
        ctx: RequestContext,
        attemptId: ID,
        decided: { reviewedBy: string; reviewedAt: Date; reviewNote: string | null },
    ): Promise<BdPaymentAttempt> {
        const found = await this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .findOne({ where: { id: attemptId } });
        if (!found) throw new OnlinePaymentError('NOT_FOUND');
        const handle = await this.gateways.handleFor(ctx, found.gateway, found.mode);
        if (!handle) throw new OnlinePaymentError('UNAVAILABLE');

        const claimed = await this.connection.withTransaction(ctx, async txCtx => {
            const attempt = await this.locked(txCtx, attemptId);
            if (!attempt) throw new OnlinePaymentError('NOT_FOUND');
            if (attempt.reviewState !== 'open') throw new OnlinePaymentError('NOT_OPEN');
            // The same ID again when an earlier request got no answer: the gateway refunds one ID once.
            const refundTransId = attempt.refundTransId ?? newRefundId();
            await this.connection.getRepository(txCtx, BdPaymentAttempt).update(attempt.id, {
                reviewState: 'refunding',
                refundTransId,
                refundRequestedAt: new Date(),
                nextCheckAt: new Date(Date.now() + 5 * MINUTE),
            });
            // As before the claim (bKash's repeat guard reads the earlier refundRequestedAt).
            return { ...attempt, refundTransId };
        });

        let refund: RefundOutcome | null = null;
        let lost: string | null = null;
        try {
            refund = await handle.driver.refund(
                handle.call,
                claimed,
                claimed.paidAmount ?? claimed.amount,
                `Refund (${claimed.reviewReason})`,
            );
        } catch (error) {
            this.gateways.noteFailure(claimed.gateway, claimed.mode, error);
            lost = error instanceof Error ? error.message : String(error);
        }

        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, BdPaymentAttempt);
            const attempt = await this.locked(txCtx, attemptId);
            if (!attempt) return new OnlinePaymentError('NOT_FOUND');
            const refundTransId = claimed.refundTransId;
            const events = refund
                ? withEvent(attempt.events, 'refund', refund.outcome, { refundTransId, response: refund.raw })
                : withEvent(attempt.events, 'refund', 'error', { refundTransId, message: lost });
            if (attempt.reviewState !== 'refunding' || attempt.refundTransId !== refundTransId) {
                // Decided meanwhile (staff marked it resolved, a check found it finished): only logged.
                await repository.update(attempt.id, { events });
                return (await repository.findOne({ where: { id: attempt.id } }))!;
            }
            const extra = {
                amount: attempt.paidAmount ?? attempt.amount,
                reason: attempt.reviewReason ?? undefined,
                note: decided.reviewNote ?? undefined,
            };
            if (!refund) {
                await repository.update(attempt.id, { ...decided, events });
                await this.history(txCtx, attempt, 'refundUnknown', extra);
                return new OnlinePaymentError('REFUND_UNKNOWN', lost ?? undefined);
            }
            if (refund.outcome === 'failed') {
                // Refused: nothing was refunded, staff decide again; trying again is a new refund (new ID).
                await repository.update(attempt.id, {
                    events,
                    reviewState: 'open',
                    refundTransId: null,
                    nextCheckAt: null,
                    // Refused before anything was sent (bKash's own limits): no request to wait for.
                    ...(refund.raw === null ? { refundRequestedAt: claimed.refundRequestedAt } : {}),
                });
                return new OnlinePaymentError(REFUSAL_ERRORS[refund.code ?? 'refused'], refund.message);
            }
            const processing = refund.outcome === 'processing';
            await repository.update(attempt.id, {
                ...decided,
                events,
                reviewState: processing ? 'refunding' : 'refunded',
                refundReference: refund.reference ?? null,
                nextCheckAt: processing ? new Date(Date.now() + 5 * MINUTE) : null,
            });
            await this.history(txCtx, attempt, processing ? 'refunding' : 'refunded', extra);
            return (await repository.findOne({ where: { id: attempt.id } }))!;
        });
        // Returned from the transaction, not thrown in it: what happened stays in the attempt's log.
        if (result instanceof OnlinePaymentError) throw result;
        return result;
    }

    /** "Test connection": a reason code the admin translates, with the gateway's own words as detail. */
    async testConnection(
        ctx: RequestContext,
        gateway: OnlineGateway,
        mode: 'sandbox' | 'live',
    ): Promise<{ ok: boolean; reason: string | null; detail: string | null }> {
        const handle = await this.gateways.handleFor(ctx, gateway, mode);
        if (!handle) return { ok: false, reason: 'missingCredentials', detail: null };
        const result = await handle.driver.testConnection(handle.call);
        return result.ok
            ? { ok: true, reason: null, detail: null }
            : { ok: false, reason: result.reason, detail: result.detail };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    private attemptByToken(ctx: RequestContext, token: string) {
        if (!ATTEMPT_TOKEN.test(token)) return Promise.resolve(null);
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

    /** Logs a gateway event on the attempt (see `record`). */
    private addEvent(
        ctx: RequestContext,
        attempt: BdPaymentAttempt,
        source: string,
        status: string,
        data: unknown,
    ) {
        return this.record(ctx, attempt.id, [source, status, data]);
    }

    /**
     * Appends an event to the attempt's log, with other changes, under the row lock: notifications
     * arrive in parallel (IPN and return post, two callbacks), and a read-modify-write of the log
     * without the lock would drop one of them.
     */
    private async record(
        ctx: RequestContext,
        attemptId: ID,
        [source, status, data]: [string, string, unknown],
        changes: Partial<BdPaymentAttempt> = {},
    ) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const attempt = await this.locked(txCtx, attemptId);
            if (!attempt) return;
            await this.connection.getRepository(txCtx, BdPaymentAttempt).update(attempt.id, {
                ...changes,
                events: withEvent(attempt.events, source, status, data),
            });
        });
    }

    /** The attempt, its row locked until the transaction ends. */
    private locked(ctx: RequestContext, attemptId: ID): Promise<BdPaymentAttempt | null> {
        return this.connection
            .getRepository(ctx, BdPaymentAttempt)
            .createQueryBuilder('attempt')
            .setLock('pessimistic_write')
            .where('attempt.id = :id', { id: attemptId })
            .getOne();
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

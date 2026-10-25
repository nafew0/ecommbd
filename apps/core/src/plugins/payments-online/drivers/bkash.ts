import {
    BKASH_LIMITS,
    bkashFailure,
    bkashPayerReference,
    fromGatewayAmount,
    HttpError,
    maskWallet,
    toGatewayAmount,
} from '@ecommbd/shared';
import {
    type AttemptRefs,
    type GatewayCall,
    type GatewayDriver,
    GatewayError,
    type GatewayMessage,
    type GatewayOutcome,
    jsonOf,
    type RefundOutcome,
    type RefundStatus,
    str,
    type StartPaymentInput,
} from './types';

/**
 * bKash tokenized checkout v2, without agreement (one payment at a time): create a payment, send
 * the shopper to bKash's page, then on the success callback **execute** it, once. bKash: "callback
 * isn't final confirmation" and "a timeout isn't a failure", so a failed or unanswered execute is
 * followed by a **query**, whose answer counts; the reconciliation task only ever queries. The token
 * comes from the store's shared one (BkashTokenService). Docs: https://developer.bka.sh/docs
 */

const endpoint = (call: GatewayCall, path: string) => `${call.baseUrl.replace(/\/$/, '')}${path}`;

/** The first of these fields that is set: bKash's pages spell the same field differently. */
const pick = (body: Record<string, unknown>, ...names: string[]): string | null => {
    for (const name of names) {
        const value = str(body[name]);
        if (value) return value;
    }
    return null;
};

export interface BkashErrorInfo {
    code: string;
    message: GatewayMessage;
}

/**
 * bKash's error on a payment or refund call: v2 has no statusCode there, an error has `externalCode`
 * with bKash's message in English and Bangla. Older answers used statusCode / errorCode.
 */
export function bkashError(body: Record<string, unknown>): BkashErrorInfo | null {
    const status = str(body.statusCode);
    const code = pick(body, 'externalCode', 'errorCode') ?? (status && status !== '0000' ? status : null);
    if (!code) return null;
    return {
        code,
        message: {
            en: pick(body, 'errorMessageEn', 'errorMessage', 'statusMessage')?.slice(0, 255) ?? null,
            bn: pick(body, 'errorMessageBn')?.slice(0, 255) ?? null,
        },
    };
}

const describe = (error: BkashErrorInfo) => `${error.code}: ${error.message.en ?? 'no message'}`;

export interface BkashToken {
    idToken: string;
    refreshToken: string | null;
    /** Milliseconds the id_token lives. */
    expiresInMs: number;
}

/**
 * Grant or refresh a token. Only BkashTokenService calls this: bKash blocks an app for an hour after a
 * third grant or refresh in an hour, so it's never retried and never called per request.
 */
export async function requestBkashToken(call: GatewayCall, refreshToken?: string): Promise<BkashToken> {
    const response = await call.http.request(
        endpoint(call, refreshToken ? '/auth/refresh-token' : '/auth/grant-token'),
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                username: call.credentials.username ?? '',
                password: call.credentials.password ?? '',
            },
            body: JSON.stringify({
                app_key: call.credentials.appKey,
                app_secret: call.credentials.appSecret,
                ...(refreshToken ? { refresh_token: refreshToken } : {}),
            }),
            idempotent: false,
            timeoutMs: BKASH_LIMITS.timeoutMs,
        },
    );
    const body = jsonOf(response);
    const idToken = str(body.id_token);
    if (str(body.statusCode) !== '0000' || !idToken) {
        throw new GatewayError(
            `bKash refused the credentials (${str(body.statusCode) ?? 'no code'}: ${str(body.statusMessage) ?? 'no message'})`,
            body,
        );
    }
    const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    return { idToken, refreshToken: str(body.refresh_token), expiresInMs: seconds * 1000 };
}

/** A call with the store's token (raw, no "Bearer"); after a 401 the token is renewed once, never in a loop. */
async function api(
    call: GatewayCall,
    path: string,
    payload: Record<string, unknown>,
    idempotent: boolean,
): Promise<Record<string, unknown>> {
    if (!call.token) throw new GatewayError('No bKash token');
    for (let round = 0; ; round++) {
        const response = await call.http.request(endpoint(call, path), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                authorization: await call.token(round > 0),
                'x-app-key': call.credentials.appKey ?? '',
            },
            body: JSON.stringify(payload),
            idempotent,
            timeoutMs: BKASH_LIMITS.timeoutMs,
        });
        if (response.status === 401 && round === 0) continue;
        return jsonOf(response);
    }
}

const PENDING = new Set(['Initiated', 'Inprogress', 'Pending Authorized', 'Authorized']);

/** A payment record (execute or query) in our words. */
export function outcomeOf(body: Record<string, unknown>): GatewayOutcome {
    const error = bkashError(body);
    const status = pick(body, 'transactionStatus') ?? error?.code ?? 'unknown';
    const outcome: GatewayOutcome['outcome'] =
        status === 'Completed' && !error
            ? 'paid'
            : PENDING.has(status) && !error
              ? 'pending'
              : status === 'Cancelled'
                ? 'cancelled'
                : 'failed';
    const trxId = pick(body, 'trxId', 'trxID');
    return {
        outcome,
        status,
        token: pick(body, 'merchantInvoiceNumber', 'merchantInvoice'),
        amount: fromGatewayAmount(body.amount),
        currency: str(body.currency),
        reference: trxId ? `bkash:${trxId}` : null,
        transactionId: trxId,
        failureCode: outcome === 'failed' ? bkashFailure(error?.code) : undefined,
        failureMessage: error?.message,
        maxRefundable: fromGatewayAmount(body.maxRefundableAmount),
        payerAccount: maskWallet(pick(body, 'payerAccount', 'customerMsisdn')),
        raw: body,
    };
}

/** One refund of a transaction, as Refund Status lists it. */
interface BkashRefund {
    refundTrxId: string | null;
    status: string;
    amount: number | null;
}

async function refundsOf(call: GatewayCall, attempt: AttemptRefs) {
    const body = await api(
        call,
        '/refund/payment/status',
        { paymentId: attempt.gatewaySessionId, trxId: attempt.gatewayTransactionId },
        true,
    );
    const error = bkashError(body);
    const list = Array.isArray(body.refundTransactions) ? body.refundTransactions : [];
    if (error && !list.length) {
        // No refund made yet is an answer too.
        return { refunds: [] as BkashRefund[], raw: body };
    }
    const refunds = list
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(item => ({
            refundTrxId: pick(item, 'refundTrxId', 'refundTrxID'),
            status: pick(item, 'refundTransactionStatus', 'transactionStatus') ?? 'unknown',
            amount: fromGatewayAmount(item.refundAmount ?? item.amount),
        }));
    return { refunds, raw: body };
}

/** What Search Transaction says about a trxId, for staff on a support call. */
export interface BkashTransaction {
    trxId: string;
    status: string;
    /** Poisha. */
    amount: number | null;
    payerAccount: string | null;
    completedTime: string | null;
    error: string | null;
}

export const bkashDriver: GatewayDriver & {
    execute(call: GatewayCall, attempt: AttemptRefs): Promise<GatewayOutcome>;
    search(call: GatewayCall, trxId: string): Promise<BkashTransaction>;
} = {
    /** Uses the shared token: pressing it again doesn't spend bKash's two token calls an hour. */
    async testConnection(call) {
        try {
            if (!call.token) throw new GatewayError('No bKash token');
            await call.token(false);
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    },

    async start(call, input: StartPaymentInput) {
        const body = await api(
            call,
            '/payment/create',
            {
                // The shopper's wallet, filled in on bKash's page.
                payerReference: bkashPayerReference(input.customer.phone) || input.orderCode,
                callbackURL: input.urls.callback,
                amount: toGatewayAmount(input.amount),
                currency: 'BDT',
                intent: 'sale',
                merchantInvoiceNumber: input.token,
            },
            false,
        );
        const error = bkashError(body);
        // Sent to the shopper as bKash gave it: never built or changed by us.
        const redirectUrl = pick(body, 'bKashURL', 'bkashURL');
        const sessionId = pick(body, 'paymentId', 'paymentID');
        if (error || !redirectUrl || !sessionId) {
            throw new GatewayError(
                `bKash refused the payment (${error ? describe(error) : 'no payment page'})`,
                body,
            );
        }
        return { redirectUrl, sessionId, signature: str(body.signature), raw: body };
    },

    /**
     * Execute after the shopper approved; the service makes sure it's sent once per paymentId. When it
     * fails or doesn't answer, the query decides; "Initiated" then means it will never complete
     * (bKash: start a new payment), so it's a failure with execute's reason.
     */
    async execute(call, attempt) {
        if (!attempt.gatewaySessionId) throw new GatewayError('No bKash paymentId');
        let executed: GatewayOutcome | null = null;
        try {
            const body = await api(call, '/payment/execute', { paymentId: attempt.gatewaySessionId }, false);
            executed = outcomeOf(body);
            if (executed.outcome === 'paid') return executed;
        } catch (error) {
            if (!(error instanceof HttpError) && !(error instanceof GatewayError)) throw error;
        }
        const queried = await this.query(call, attempt);
        if (queried.outcome !== 'failed' && queried.outcome !== 'pending') return queried;
        return {
            ...queried,
            outcome: 'failed',
            failureCode: executed?.failureCode ?? queried.failureCode ?? 'failed',
            failureMessage: executed?.failureMessage ?? queried.failureMessage,
        };
    },

    async query(call, attempt) {
        if (!attempt.gatewaySessionId) return { outcome: 'pending', status: 'NOT_STARTED', raw: null };
        const body = await api(call, '/query/payment', { paymentId: attempt.gatewaySessionId }, true);
        const error = bkashError(body);
        if (error && !pick(body, 'transactionStatus')) {
            // 2002 Invalid Payment ID: it can never be paid; the shopper pays again.
            if (error.code === '2002') {
                return {
                    outcome: 'failed',
                    status: error.code,
                    failureCode: 'failed',
                    failureMessage: error.message,
                    raw: body,
                };
            }
            throw new GatewayError(`bKash query failed (${describe(error)})`, body);
        }
        return outcomeOf(body);
    },

    async search(call, trxId) {
        const body = await api(call, '/general/search-transaction', { trxId }, true);
        const error = bkashError(body);
        return {
            trxId,
            status: pick(body, 'transactionStatus') ?? error?.code ?? 'unknown',
            amount: fromGatewayAmount(body.amount),
            payerAccount: maskWallet(pick(body, 'payerAccount', 'customerMsisdn')),
            completedTime: pick(body, 'completedTime', 'transactionCompletedTime'),
            error: error ? describe(error) : null,
        };
    },

    /**
     * A refund by bKash's rules: within 60 days, no more than maxRefundableAmount, at most 10 per
     * transaction, and never repeated within 10 minutes. After a request whose answer never came,
     * Refund Status is asked first, so the money is never sent back twice.
     */
    async refund(call, attempt, amount, reason): Promise<RefundOutcome> {
        if (!attempt.gatewaySessionId || !attempt.gatewayTransactionId) {
            return { outcome: 'failed', message: 'No bKash payment to refund', raw: null };
        }
        if (attempt.paidAt && Date.now() - attempt.paidAt.getTime() > BKASH_LIMITS.refundWindowMs) {
            return {
                outcome: 'failed',
                message: 'bKash refunds only within 60 days of the payment',
                raw: null,
            };
        }
        if (attempt.maxRefundableAmount != null && amount > attempt.maxRefundableAmount) {
            return {
                outcome: 'failed',
                message: `bKash can refund at most ৳${toGatewayAmount(attempt.maxRefundableAmount)} of this payment`,
                raw: null,
            };
        }
        if (attempt.refundRequestedAt) {
            const earlier = await refundsOf(call, attempt);
            const done = earlier.refunds.find(item => item.status === 'Completed');
            if (done) return { outcome: 'refunded', reference: done.refundTrxId, raw: earlier.raw };
            if (Date.now() - attempt.refundRequestedAt.getTime() < BKASH_LIMITS.refundRepeatMs) {
                return {
                    outcome: 'failed',
                    message: 'A refund was asked for less than 10 minutes ago. Try again in a few minutes.',
                    raw: earlier.raw,
                };
            }
            if (earlier.refunds.length >= BKASH_LIMITS.refundsPerTransaction) {
                return {
                    outcome: 'failed',
                    message: 'bKash allows at most 10 refunds of a payment',
                    raw: earlier.raw,
                };
            }
        }
        let body: Record<string, unknown>;
        try {
            body = await api(
                call,
                '/refund/payment/transaction',
                {
                    paymentId: attempt.gatewaySessionId,
                    trxId: attempt.gatewayTransactionId,
                    refundAmount: toGatewayAmount(amount),
                    sku: 'order',
                    reason: reason.slice(0, 255),
                },
                false,
            );
        } catch (error) {
            if (!(error instanceof HttpError) && !(error instanceof GatewayError)) throw error;
            // No answer: bKash says ask Refund Status before trying again.
            const after = await refundsOf(call, attempt).catch(() => null);
            const done = after?.refunds.find(item => item.status === 'Completed');
            if (done) return { outcome: 'refunded', reference: done.refundTrxId, raw: after!.raw };
            throw error;
        }
        const error = bkashError(body);
        if (error) return { outcome: 'failed', message: describe(error), raw: body };
        const status = pick(body, 'refundTransactionStatus', 'transactionStatus');
        return {
            outcome: status === 'Completed' ? 'refunded' : 'processing',
            reference: pick(body, 'refundTrxId', 'refundTrxID'),
            raw: body,
        };
    },

    async refundStatus(call, attempt, reference): Promise<RefundStatus> {
        const { refunds, raw } = await refundsOf(call, attempt);
        const refund = refunds.find(item => item.refundTrxId === reference) ?? refunds[refunds.length - 1];
        const status = refund?.status ?? 'unknown';
        return {
            outcome:
                status === 'Completed'
                    ? 'refunded'
                    : status === 'Failed' || status === 'Cancelled'
                      ? 'cancelled'
                      : 'processing',
            raw,
        };
    },
};

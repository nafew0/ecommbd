import { bkashFailure, fromGatewayAmount, HttpError } from '@ecommbd/shared';
import {
    type AttemptRefs,
    type GatewayCall,
    type GatewayDriver,
    GatewayError,
    type GatewayOutcome,
    jsonOf,
    type RefundOutcome,
    str,
    type StartPaymentInput,
} from './types';

/**
 * bKash tokenized checkout (v1.2.0-beta): grant a token, create a payment, send the shopper to
 * bKash, then on the callback **execute** it. bKash's known failure is money taken while execute
 * times out or errors, so a failed execute is always followed by a **query**, and the query's answer
 * settles it (the reconciliation task asks again later). Docs:
 * https://developer.bka.sh/docs/tokenized-checkout-overview
 */

interface CachedToken {
    idToken: string;
    refreshToken: string;
    expiresAt: number;
}

/** Tokens live an hour; reused until 5 minutes before they expire. One cache per process. */
const tokens = new Map<string, CachedToken>();
const EARLY_MS = 5 * 60_000;

const cacheKey = (call: GatewayCall) =>
    `${call.baseUrl}|${call.credentials.username}|${call.credentials.appKey}`;

/** For tests. */
export function clearBkashTokens(): void {
    tokens.clear();
}

const endpoint = (call: GatewayCall, path: string) =>
    `${call.baseUrl.replace(/\/$/, '')}/tokenized/checkout/${path}`;

const ok = (body: Record<string, unknown>) => str(body.statusCode) === '0000';

/** bKash's error words: statusCode/statusMessage, or errorCode/errorMessage on some failures. */
const codeOf = (body: Record<string, unknown>) => str(body.statusCode) ?? str(body.errorCode) ?? 'unknown';
const messageOf = (body: Record<string, unknown>) =>
    str(body.statusMessage) ?? str(body.errorMessage) ?? 'no message';

async function grant(call: GatewayCall, refreshToken?: string): Promise<CachedToken> {
    const response = await call.http.request(endpoint(call, refreshToken ? 'token/refresh' : 'token/grant'), {
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
        // Asking for a token twice is harmless.
        idempotent: true,
    });
    const body = jsonOf(response);
    const idToken = str(body.id_token);
    if (!idToken) {
        throw new GatewayError(`bKash refused the credentials (${codeOf(body)}: ${messageOf(body)})`, body);
    }
    const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    return { idToken, refreshToken: str(body.refresh_token) ?? '', expiresAt: Date.now() + seconds * 1000 };
}

async function token(call: GatewayCall, fresh = false): Promise<string> {
    const key = cacheKey(call);
    const cached = tokens.get(key);
    if (!fresh && cached && cached.expiresAt - EARLY_MS > Date.now()) return cached.idToken;
    let next: CachedToken;
    try {
        next = cached?.refreshToken && !fresh ? await grant(call, cached.refreshToken) : await grant(call);
    } catch (error) {
        if (!cached?.refreshToken || fresh) throw error;
        next = await grant(call);
    }
    tokens.set(key, next);
    return next.idToken;
}

/** A call with the token; an expired or revoked token (HTTP 401) is replaced once and the call repeated. */
async function api(
    call: GatewayCall,
    path: string,
    payload: Record<string, unknown>,
    idempotent: boolean,
): Promise<Record<string, unknown>> {
    for (let round = 0; ; round++) {
        const response = await call.http.request(endpoint(call, path), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                authorization: await token(call, round > 0),
                'x-app-key': call.credentials.appKey ?? '',
            },
            body: JSON.stringify(payload),
            idempotent,
        });
        if (response.status === 401 && round === 0) continue;
        return jsonOf(response);
    }
}

/** A payment record (execute or query) in our words. */
export function outcomeOf(body: Record<string, unknown>, source: 'execute' | 'query'): GatewayOutcome {
    const status = str(body.transactionStatus) ?? codeOf(body);
    const completed = status === 'Completed' && (source === 'query' || ok(body));
    const outcome: GatewayOutcome['outcome'] = completed
        ? 'paid'
        : status === 'Initiated' || status === 'Inprogress' || status === 'Pending Authorized'
          ? 'pending'
          : status === 'Cancelled'
            ? 'cancelled'
            : 'failed';
    return {
        outcome,
        status,
        token: str(body.merchantInvoiceNumber),
        amount: fromGatewayAmount(body.amount),
        currency: str(body.currency),
        reference: str(body.trxID) ? `bkash:${str(body.trxID)}` : null,
        transactionId: str(body.trxID),
        failureCode: outcome === 'failed' ? bkashFailure(codeOf(body)) : undefined,
        raw: body,
    };
}

export const bkashDriver: GatewayDriver & {
    execute(call: GatewayCall, attempt: AttemptRefs): Promise<GatewayOutcome>;
} = {
    async testConnection(call) {
        try {
            await token(call, true);
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    },

    async start(call, input: StartPaymentInput) {
        const body = await api(
            call,
            'create',
            {
                mode: '0011',
                payerReference: input.orderCode,
                callbackURL: input.urls.callback,
                // Whole taka (couriers and gateways both expect it).
                amount: String(input.amount / 100),
                currency: 'BDT',
                intent: 'sale',
                merchantInvoiceNumber: input.token,
            },
            false,
        );
        const redirectUrl = str(body.bkashURL);
        const sessionId = str(body.paymentID);
        if (!ok(body) || !redirectUrl || !sessionId) {
            throw new GatewayError(`bKash refused the payment (${codeOf(body)}: ${messageOf(body)})`, body);
        }
        return { redirectUrl, sessionId, raw: body };
    },

    /**
     * Execute after the shopper approved. Never trusted alone when it fails: a timeout, a network
     * error or an error code is followed by a query, whose answer is the outcome.
     */
    async execute(call, attempt) {
        if (!attempt.gatewaySessionId) throw new GatewayError('No bKash paymentID');
        try {
            const body = await api(call, 'execute', { paymentID: attempt.gatewaySessionId }, false);
            const executed = outcomeOf(body, 'execute');
            if (executed.outcome === 'paid') return executed;
            const queried = await this.query(call, attempt);
            // Keep execute's reason when the query only says it failed.
            return queried.outcome === 'failed' ? { ...queried, failureCode: executed.failureCode } : queried;
        } catch (error) {
            if (!(error instanceof HttpError) && !(error instanceof GatewayError)) throw error;
            return this.query(call, attempt);
        }
    },

    async query(call, attempt) {
        if (!attempt.gatewaySessionId) return { outcome: 'pending', status: 'NOT_STARTED', raw: null };
        const body = await api(call, 'payment/status', { paymentID: attempt.gatewaySessionId }, true);
        if (!str(body.transactionStatus)) {
            throw new GatewayError(`bKash query failed (${codeOf(body)}: ${messageOf(body)})`, body);
        }
        return outcomeOf(body, 'query');
    },

    async refund(call, attempt, amount, reason): Promise<RefundOutcome> {
        if (!attempt.gatewaySessionId || !attempt.gatewayTransactionId) {
            return { outcome: 'failed', message: 'No bKash payment to refund', raw: null };
        }
        const body = await api(
            call,
            'payment/refund',
            {
                paymentID: attempt.gatewaySessionId,
                trxID: attempt.gatewayTransactionId,
                amount: String(amount / 100),
                sku: 'order',
                reason: reason.slice(0, 100),
            },
            false,
        );
        const refunded = str(body.transactionStatus) === 'Completed';
        return {
            outcome: refunded ? 'refunded' : 'failed',
            reference: str(body.refundTrxID),
            message: refunded ? undefined : `${codeOf(body)}: ${messageOf(body)}`,
            raw: body,
        };
    },
};

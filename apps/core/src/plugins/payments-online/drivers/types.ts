import type { GatewayCredentials, HttpClient } from '@ecommbd/shared';

/** What a driver needs for one call: the shared HTTP client, the gateway's address and the store's credentials. */
export interface GatewayCall {
    http: HttpClient;
    baseUrl: string;
    credentials: GatewayCredentials;
}

export interface StartPaymentInput {
    /** Our attempt token: SSLCommerz `tran_id`, bKash `merchantInvoiceNumber`. */
    token: string;
    /** Poisha. */
    amount: number;
    orderCode: string;
    urls: {
        /** SSLCommerz posts the shopper back to these. */
        success: string;
        fail: string;
        cancel: string;
        /** SSLCommerz's server-to-server notification. */
        ipn: string;
        /** bKash sends the shopper back here with paymentID and status. */
        callback: string;
    };
    customer: { name: string; phone: string; email: string; address: string; city: string };
    items: { count: number; names: string };
}

export interface StartPaymentResult {
    redirectUrl: string;
    sessionId: string;
    raw: unknown;
}

/**
 * The gateway's answer, in our words. `paid` only comes from a server-to-server check (validation,
 * execute or query), never from what the shopper's browser brought back.
 */
export interface GatewayOutcome {
    outcome: 'paid' | 'pending' | 'failed' | 'cancelled';
    /** The gateway's own status word, for the attempt's event log. */
    status: string;
    /** Our token as the gateway reports it (checked against the attempt). */
    token?: string | null;
    /** Poisha. */
    amount?: number | null;
    currency?: string | null;
    /** Unique proof of this payment, e.g. SSLCommerz val_id or bKash trxID. */
    reference?: string | null;
    /** What staff search for in the gateway's panel. */
    transactionId?: string | null;
    /** The gateway flags the payment as risky (SSLCommerz risk_level 1). */
    risky?: boolean;
    /** Why it failed, for the shopper (bKash groups); undefined for a plain failure. */
    failureCode?: string;
    raw: unknown;
}

export interface RefundOutcome {
    outcome: 'refunded' | 'processing' | 'failed';
    reference?: string | null;
    message?: string;
    raw: unknown;
}

/** The attempt as the drivers need it (a BdPaymentAttempt fits). */
export interface AttemptRefs {
    token: string;
    gatewaySessionId: string | null;
    gatewayTransactionId: string | null;
}

export interface GatewayDriver {
    /** A harmless call that proves the credentials work. */
    testConnection(call: GatewayCall): Promise<{ ok: true } | { ok: false; message: string }>;
    start(call: GatewayCall, input: StartPaymentInput): Promise<StartPaymentResult>;
    /** Asks the gateway what happened to an attempt (reconciliation, "Check status now"). */
    query(call: GatewayCall, attempt: AttemptRefs): Promise<GatewayOutcome>;
    refund(call: GatewayCall, attempt: AttemptRefs, amount: number, reason: string): Promise<RefundOutcome>;
}

/** A gateway answered with something we can't use (an error status, a malformed body). */
export class GatewayError extends Error {
    constructor(
        message: string,
        readonly raw: unknown = null,
    ) {
        super(message);
        this.name = 'GatewayError';
    }
}

/** A JSON body, or a GatewayError naming the HTTP status. */
export function jsonOf(response: { status: number; text(): string }): Record<string, unknown> {
    let body: unknown;
    try {
        body = JSON.parse(response.text());
    } catch {
        throw new GatewayError(`Unexpected response (HTTP ${response.status})`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new GatewayError(`Unexpected response (HTTP ${response.status})`, body);
    }
    return body as Record<string, unknown>;
}

export const str = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null;

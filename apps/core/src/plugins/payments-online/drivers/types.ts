import type { GatewayCredentials, HttpClient } from '@ecommbd/shared';

/** What a driver needs for one call: the shared HTTP client, the gateway's address and the store's credentials. */
export interface GatewayCall {
    http: HttpClient;
    baseUrl: string;
    credentials: GatewayCredentials;
    /** bKash: the store's shared token (BkashTokenService). `renew` after a 401, at most once per call. */
    token?: (renew: boolean) => Promise<string>;
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
    customer: { name: string; phone: string; email: string; address: string; city: string; postcode: string };
    items: { count: number; names: string };
}

export interface StartPaymentResult {
    redirectUrl: string;
    sessionId: string;
    /** bKash's `signature`: its callback must bring the same one back. */
    signature?: string | null;
    raw: unknown;
}

/** The gateway's own explanation, for the shopper (bKash errorMessageEn / errorMessageBn). */
export interface GatewayMessage {
    en: string | null;
    bn: string | null;
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
    /** The gateway's own words on the risk (SSLCommerz risk_title), for staff. */
    riskTitle?: string | null;
    /** Why it failed, for the shopper (bKash groups); undefined for a plain failure. */
    failureCode?: string;
    /** The gateway's own words on why it failed, in English and Bangla (bKash). */
    failureMessage?: GatewayMessage;
    /** Poisha that can still be refunded (bKash maxRefundableAmount). */
    maxRefundable?: number | null;
    /** The payer's wallet, masked to its last 3 digits (bKash). */
    payerAccount?: string | null;
    raw: unknown;
}

export interface RefundOutcome {
    outcome: 'refunded' | 'processing' | 'failed';
    reference?: string | null;
    message?: string;
    raw: unknown;
}

/** A refund the gateway was still processing, asked about again (SSLCommerz Refund Query). */
export interface RefundStatus {
    outcome: 'refunded' | 'processing' | 'cancelled';
    raw: unknown;
}

/** The attempt as the drivers need it (a BdPaymentAttempt fits). */
export interface AttemptRefs {
    token: string;
    gatewaySessionId: string | null;
    gatewayTransactionId: string | null;
    /** Our ID for the refund being made (SSLCommerz refund_trans_id): one per refund, at most 30 characters. */
    refundTransId?: string | null;
    /** bKash's refund rules: within 60 days, at most maxRefundableAmount, never twice in 10 minutes. */
    paidAt?: Date | null;
    maxRefundableAmount?: number | null;
    /** When our last refund request was sent (its answer may never have come). */
    refundRequestedAt?: Date | null;
}

export interface GatewayDriver {
    /** A harmless call that proves the credentials work. */
    testConnection(call: GatewayCall): Promise<{ ok: true } | { ok: false; message: string }>;
    start(call: GatewayCall, input: StartPaymentInput): Promise<StartPaymentResult>;
    /** Asks the gateway what happened to an attempt (reconciliation, "Check status now"). */
    query(call: GatewayCall, attempt: AttemptRefs): Promise<GatewayOutcome>;
    refund(call: GatewayCall, attempt: AttemptRefs, amount: number, reason: string): Promise<RefundOutcome>;
    /** Asks again about a refund that was processing; gateways without it finish refunds at once. */
    refundStatus?(call: GatewayCall, attempt: AttemptRefs, reference: string): Promise<RefundStatus>;
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

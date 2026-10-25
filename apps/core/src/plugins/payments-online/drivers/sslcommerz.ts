import { fromGatewayAmount, toGatewayAmount } from '@ecommbd/shared';
import {
    type AttemptRefs,
    type GatewayCall,
    type GatewayDriver,
    GatewayError,
    type GatewayOutcome,
    jsonOf,
    type RefundOutcome,
    type RefundStatus,
    str,
    type StartPaymentInput,
    type StartPaymentResult,
} from './types';

/**
 * SSLCommerz (API v4): a session gives the hosted payment page; the IPN and the return posts carry a
 * `val_id`, which only counts once the validation API confirms it. Docs:
 * https://developer.sslcommerz.com/doc/v4/
 */

const PAID = new Set(['VALID', 'VALIDATED']);
const FAILED = new Set(['FAILED', 'EXPIRED', 'INVALID_TRANSACTION']);
const CANCELLED = new Set(['CANCELLED']);

const auth = (call: GatewayCall) => ({
    store_id: call.credentials.storeId ?? '',
    store_passwd: call.credentials.storePassword ?? '',
});

function url(call: GatewayCall, path: string, params: Record<string, string>): string {
    const target = new URL(`${call.baseUrl.replace(/\/$/, '')}${path}`);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    return target.toString();
}

/** One transaction record from the validation or transaction-query API, in our words. */
export function outcomeOf(record: Record<string, unknown>): GatewayOutcome {
    const status = (str(record.status) ?? 'UNKNOWN').toUpperCase();
    return {
        outcome: PAID.has(status)
            ? 'paid'
            : FAILED.has(status)
              ? 'failed'
              : CANCELLED.has(status)
                ? 'cancelled'
                : 'pending',
        status,
        token: str(record.tran_id),
        amount: fromGatewayAmount(record.amount),
        currency: str(record.currency) ?? str(record.currency_type),
        reference: str(record.val_id) ? `sslcommerz:${str(record.val_id)}` : null,
        transactionId: str(record.bank_tran_id),
        // risk_level 1: SSLCommerz suspects the card; staff decide (phase 18).
        risky: str(record.risk_level) === '1',
        riskTitle: str(record.risk_title)?.slice(0, 100) ?? null,
        raw: record,
    };
}

export const sslcommerzDriver: GatewayDriver & {
    validate(call: GatewayCall, valId: string): Promise<GatewayOutcome>;
} = {
    async testConnection(call) {
        try {
            // A query for a transaction that can't exist: the API says whether the store is accepted.
            const body = jsonOf(
                await call.http.request(
                    url(call, '/validator/api/merchantTransIDvalidationAPI.php', {
                        tran_id: 'connection-test',
                        ...auth(call),
                        format: 'json',
                    }),
                ),
            );
            const connect = str(body.APIConnect) ?? '';
            return connect === 'DONE'
                ? { ok: true }
                : {
                      ok: false,
                      message: `SSLCommerz refused the store ID or password (${connect || 'no answer'})`,
                  };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    },

    async start(call, input: StartPaymentInput): Promise<StartPaymentResult> {
        const form = new URLSearchParams({
            ...auth(call),
            total_amount: toGatewayAmount(input.amount),
            currency: 'BDT',
            tran_id: input.token,
            success_url: input.urls.success,
            fail_url: input.urls.fail,
            cancel_url: input.urls.cancel,
            ipn_url: input.urls.ipn,
            cus_name: input.customer.name.slice(0, 50),
            // At most 50 characters: the service sends the store's address instead of a longer one.
            cus_email: input.customer.email,
            cus_add1: input.customer.address.slice(0, 50),
            cus_city: input.customer.city.slice(0, 50),
            cus_postcode: input.customer.postcode.slice(0, 10),
            cus_country: 'Bangladesh',
            cus_phone: input.customer.phone.slice(0, 20),
            // We deliver ourselves; SSLCommerz needs no shipping details.
            shipping_method: 'NO',
            num_of_item: String(input.items.count),
            product_name: input.items.names.slice(0, 255) || 'Order',
            product_category: 'General',
            product_profile: 'physical-goods',
            value_a: input.token,
            value_b: input.orderCode,
        });
        const response = await call.http.request(`${call.baseUrl.replace(/\/$/, '')}/gwprocess/v4/api.php`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        const body = jsonOf(response);
        const redirectUrl = str(body.GatewayPageURL);
        if (str(body.status)?.toUpperCase() !== 'SUCCESS' || !redirectUrl) {
            throw new GatewayError(
                `SSLCommerz refused the session: ${str(body.failedreason) ?? 'no reason given'}`,
                body,
            );
        }
        return { redirectUrl, sessionId: str(body.sessionkey) ?? '', raw: body };
    },

    /** The validation API: the only proof that a `val_id` from an IPN or a return post is real. */
    async validate(call, valId) {
        const body = jsonOf(
            await call.http.request(
                url(call, '/validator/api/validationserverAPI.php', {
                    val_id: valId,
                    ...auth(call),
                    v: '1',
                    format: 'json',
                }),
            ),
        );
        return outcomeOf(body);
    },

    async query(call, attempt: AttemptRefs) {
        const body = jsonOf(
            await call.http.request(
                url(call, '/validator/api/merchantTransIDvalidationAPI.php', {
                    tran_id: attempt.token,
                    ...auth(call),
                    format: 'json',
                }),
            ),
        );
        if (str(body.APIConnect) !== 'DONE') {
            throw new GatewayError(`SSLCommerz query failed (${str(body.APIConnect) ?? 'no answer'})`, body);
        }
        const records = (Array.isArray(body.element) ? body.element : []).filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object',
        );
        // A paid record wins; otherwise the latest word on the attempt.
        const paid = records.find(record => PAID.has((str(record.status) ?? '').toUpperCase()));
        if (paid) return outcomeOf(paid);
        const last = records[records.length - 1];
        return last ? outcomeOf(last) : { outcome: 'pending', status: 'NOT_FOUND', raw: body };
    },

    async refund(call, attempt, amount, reason): Promise<RefundOutcome> {
        if (!attempt.gatewayTransactionId) {
            return { outcome: 'failed', message: 'No bank transaction ID to refund', raw: null };
        }
        // Required since 24 February 2025: our own unique ID for each refund.
        if (!attempt.refundTransId) {
            return { outcome: 'failed', message: 'No refund ID', raw: null };
        }
        const body = jsonOf(
            await call.http.request(
                url(call, '/validator/api/merchantTransIDvalidationAPI.php', {
                    bank_tran_id: attempt.gatewayTransactionId,
                    refund_trans_id: attempt.refundTransId,
                    refund_amount: toGatewayAmount(amount),
                    refund_remarks: reason.slice(0, 255),
                    refe_id: attempt.token,
                    ...auth(call),
                    v: '1',
                    format: 'json',
                }),
            ),
        );
        const connect = str(body.APIConnect) ?? '';
        if (connect !== 'DONE') {
            return {
                outcome: 'failed',
                message:
                    str(body.errorReason) ?? `SSLCommerz refused the request (${connect || 'no answer'})`,
                raw: body,
            };
        }
        const status = (str(body.status) ?? '').toLowerCase();
        return {
            outcome: status === 'success' ? 'refunded' : status === 'processing' ? 'processing' : 'failed',
            reference: str(body.refund_ref_id),
            message: str(body.errorReason) ?? undefined,
            raw: body,
        };
    },

    /** Refund Query: refunded, still processing, or cancelled by SSLCommerz. */
    async refundStatus(call, reference): Promise<RefundStatus> {
        const body = jsonOf(
            await call.http.request(
                url(call, '/validator/api/merchantTransIDvalidationAPI.php', {
                    refund_ref_id: reference,
                    ...auth(call),
                    format: 'json',
                }),
            ),
        );
        const connect = str(body.APIConnect) ?? '';
        if (connect !== 'DONE') {
            throw new GatewayError(`SSLCommerz refund query failed (${connect || 'no answer'})`, body);
        }
        const status = (str(body.status) ?? '').toLowerCase();
        return {
            outcome: status === 'refunded' ? 'refunded' : status === 'cancelled' ? 'cancelled' : 'processing',
            raw: body,
        };
    },
};

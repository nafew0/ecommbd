import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

/**
 * A stand-in for SSLCommerz and bKash (phase 18), for end-to-end tests: the same endpoints and
 * answers as the gateways' documented APIs, with switches for every edge case (refusals, wrong
 * amounts, risky cards, a dropped connection on execute). bKash (tokenized checkout v2) lives under
 * `/bkash`.
 *
 * SSLCommerz's own rules are enforced: a tran_id of at most 30 characters, a cus_postcode, ৳10 to
 * ৳5,00,000, and a unique refund_trans_id on every refund (since February 2025).
 *
 * So are bKash's: the raw id_token (no "Bearer"), no `mode` field, errors as `externalCode` with
 * English and Bangla messages, Execute at most once per paymentId, `Initiated` after a failed
 * execute or a cancel, and refunds within maxRefundableAmount, none repeated within 10 minutes.
 */

export const SSL_CREDENTIALS = { storeId: 'teststore', storePassword: 'testpass' };
export const BKASH_CREDENTIALS = {
    username: 'bkuser',
    password: 'bkpass',
    appKey: 'appkey',
    appSecret: 'appsecret',
};

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

interface SslTransaction {
    tranId: string;
    amount: string;
    ipnUrl: string;
    successUrl: string;
    status: 'PENDING' | 'VALID' | 'FAILED' | 'CANCELLED';
    valId?: string;
    bankTranId?: string;
    paidAmount?: string;
    currency?: string;
    risk?: '0' | '1';
    riskTitle?: string;
}

interface SslRefund {
    bankTranId: string;
    refundTransId: string;
    amount: string;
    refId: string;
    status: 'refunded' | 'processing' | 'cancelled';
}

interface BkashPayment {
    paymentId: string;
    invoice: string;
    amount: string;
    callbackUrl: string;
    payerReference: string;
    signature: string;
    status: 'Initiated' | 'Completed' | 'Cancelled';
    trxId?: string;
    /** What execute does: complete, refuse with a code, or drop the connection after taking the money. */
    onExecute: 'complete' | 'drop' | string;
    executes: number;
    maxRefundable?: string;
    refunds: Array<{ refundTrxId: string; amount: string; at: number }>;
}

/** bKash's v2 error body: no statusCode, an externalCode with its message in both languages. */
const BKASH_ERRORS: Record<string, [string, string]> = {
    '2023': ['Insufficient Balance', 'অপর্যাপ্ত ব্যালেন্স'],
    '2014': ['Wrong verification code', 'ভুল ভেরিফিকেশন কোড'],
    '2117': ['Payment execution already been called before', 'পেমেন্ট এক্সিকিউশন আগেই করা হয়েছে'],
    '2002': ['Invalid Payment ID', 'ভুল পেমেন্ট আইডি'],
    '2072': ['Refund amount exceeds refundable amount', 'রিফান্ডের পরিমাণ সীমার বেশি'],
    '2073': ['Duplicate refund within 10 minutes', '১০ মিনিটের মধ্যে একই রিফান্ড'],
    '2080': ['Invalid request', 'ভুল অনুরোধ'],
};
const bkashErrorBody = (code: string) => ({
    externalCode: code,
    internalCode: `BK${code}`,
    errorMessageEn: BKASH_ERRORS[code]?.[0] ?? 'Failed',
    errorMessageBn: BKASH_ERRORS[code]?.[1] ?? 'ব্যর্থ',
});

export class MockGateways {
    readonly ssl = new Map<string, SslTransaction>();
    readonly bkash = new Map<string, BkashPayment>();
    readonly refunds: Array<{ gateway: string; ref: string; amount: string }> = [];
    /** SSLCommerz refunds by refund_ref_id, for Refund Query. */
    readonly sslRefunds = new Map<string, SslRefund>();
    /** Every SSLCommerz session form we were sent. */
    readonly sslSessionForms: URLSearchParams[] = [];
    /** Answer every SSLCommerz session request with this HTTP status (e.g. 503). */
    sslSessionStatus = 200;
    /** How the next SSLCommerz refunds answer: success, processing, or failed (with an errorReason). */
    sslRefundAnswer: 'success' | 'processing' | 'failed' = 'success';
    /** The validation API says INVALID_TRANSACTION for every val_id (the transaction query still works). */
    sslValidationInvalid = false;
    /** Validation and query answers leave out tran_id. */
    sslOmitTranId = false;
    /** What the next bKash executes do. */
    bkashExecute: BkashPayment['onExecute'] = 'complete';
    /** Every bKash token call (grant or refresh), oldest first. */
    readonly bkashTokenCalls: Array<'grant' | 'refresh'> = [];
    /** Calls answered with each bKash path, e.g. `payment/execute`. */
    readonly bkashCalls: string[] = [];
    /** bKash's maxRefundableAmount on the next executes (the payment's amount when unset). */
    bkashMaxRefundable?: string;
    /** The next bKash refunds: complete, or take the money and drop the connection. */
    bkashRefund: 'complete' | 'drop' = 'complete';
    sslSessions = 0;
    private server?: http.Server;
    private tokens = 0;
    private validTokens = new Set<string>();

    constructor(readonly port: number) {}

    get url() {
        return `http://127.0.0.1:${this.port}`;
    }

    start(): Promise<void> {
        this.server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => (body += chunk));
            req.on('end', () => this.handle(req, res, body));
        });
        return new Promise(resolve => this.server!.listen(this.port, '127.0.0.1', () => resolve()));
    }

    stop(): Promise<void> {
        return new Promise(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    /** The shopper pays on SSLCommerz's page. Returns the IPN SSLCommerz would post (signed). */
    sslPay(
        tranId: string,
        options: {
            amount?: string;
            currency?: string;
            risk?: '0' | '1';
            riskTitle?: string;
            fail?: boolean;
        } = {},
    ) {
        const transaction = this.ssl.get(tranId);
        if (!transaction) throw new Error(`No SSLCommerz session for ${tranId}`);
        transaction.status = options.fail ? 'FAILED' : 'VALID';
        transaction.valId = `VAL${randomBytes(6).toString('hex')}`;
        transaction.bankTranId = `BANK${randomBytes(4).toString('hex')}`;
        transaction.paidAmount = options.amount ?? transaction.amount;
        transaction.currency = options.currency ?? 'BDT';
        transaction.risk = options.risk ?? '0';
        transaction.riskTitle = options.riskTitle ?? (transaction.risk === '1' ? 'Risky' : 'Safe');
        return this.sslIpn(transaction);
    }

    /** The IPN fields for a transaction, signed with the store password like SSLCommerz does. */
    sslIpn(transaction: SslTransaction, password = SSL_CREDENTIALS.storePassword): Record<string, string> {
        const fields: Record<string, string> = {
            status: transaction.status,
            tran_id: transaction.tranId,
            val_id: transaction.valId ?? '',
            amount: transaction.paidAmount ?? transaction.amount,
            currency: transaction.currency ?? 'BDT',
            bank_tran_id: transaction.bankTranId ?? '',
            risk_level: transaction.risk ?? '0',
        };
        const pairs: Record<string, string> = { ...fields, store_passwd: md5(password) };
        const sign = md5(
            Object.keys(pairs)
                .sort()
                .map(key => `${key}=${pairs[key]}`)
                .join('&'),
        );
        return { ...fields, verify_key: Object.keys(fields).join(','), verify_sign: sign };
    }

    /** The shopper approves on bKash's page; execute then does `bkashExecute`. */
    bkashApprove(paymentId: string) {
        const payment = this.bkash.get(paymentId);
        if (!payment) throw new Error(`No bKash payment ${paymentId}`);
        payment.onExecute = this.bkashExecute;
        return payment;
    }

    /** bKash revokes every id_token it gave (the next payment call gets a 401). */
    bkashRevokeTokens() {
        this.validTokens.clear();
    }

    /** Forgets bKash's counts between tests. */
    bkashReset() {
        this.bkashTokenCalls.length = 0;
        this.bkashCalls.length = 0;
        this.bkashExecute = 'complete';
        this.bkashMaxRefundable = undefined;
        this.bkashRefund = 'complete';
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse, body: string) {
        const url = new URL(req.url ?? '/', this.url);
        const json = (status: number, value: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        if (url.pathname.startsWith('/bkash/')) return this.handleBkash(req, res, url, body, json);
        const params = url.searchParams;
        const sslAuthorized = (store: string | null, password: string | null) =>
            store === SSL_CREDENTIALS.storeId && password === SSL_CREDENTIALS.storePassword;

        if (url.pathname === '/gwprocess/v4/api.php') {
            this.sslSessions++;
            if (this.sslSessionStatus !== 200) return json(this.sslSessionStatus, { status: 'FAILED' });
            const form = new URLSearchParams(body);
            this.sslSessionForms.push(form);
            if (!sslAuthorized(form.get('store_id'), form.get('store_passwd'))) {
                return json(200, {
                    status: 'FAILED',
                    failedreason: 'Store Credential Error Or Store is De-active',
                });
            }
            const tranId = form.get('tran_id') ?? '';
            const total = Number(form.get('total_amount'));
            const refusal =
                !tranId || tranId.length > 30
                    ? 'Invalid tran_id'
                    : !form.get('cus_postcode')
                      ? 'cus_postcode is required'
                      : !(total >= 10 && total <= 500_000)
                        ? 'Amount must be between 10.00 and 500000.00'
                        : (form.get('cus_email') ?? '').length > 50
                          ? 'Invalid cus_email'
                          : null;
            if (refusal) return json(200, { status: 'FAILED', failedreason: refusal });
            this.ssl.set(tranId, {
                tranId,
                amount: form.get('total_amount')!,
                ipnUrl: form.get('ipn_url')!,
                successUrl: form.get('success_url')!,
                status: 'PENDING',
            });
            return json(200, {
                status: 'SUCCESS',
                sessionkey: `SESS${tranId.slice(0, 8)}`,
                GatewayPageURL: `${this.url}/pay/${tranId}`,
            });
        }
        if (url.pathname === '/validator/api/validationserverAPI.php') {
            if (!sslAuthorized(params.get('store_id'), params.get('store_passwd')))
                return json(200, { status: 'INVALID_TRANSACTION' });
            const transaction = [...this.ssl.values()].find(
                item => item.valId && item.valId === params.get('val_id'),
            );
            if (this.sslValidationInvalid || !transaction || transaction.status !== 'VALID')
                return json(200, { status: 'INVALID_TRANSACTION' });
            return json(200, this.sslRecord(transaction, 'VALID'));
        }
        if (url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
            if (!sslAuthorized(params.get('store_id'), params.get('store_passwd')))
                return json(200, { APIConnect: 'INVALID_REQUEST' });
            if (params.get('bank_tran_id')) {
                const refundTransId = params.get('refund_trans_id') ?? '';
                if (!refundTransId || refundTransId.length > 30) {
                    return json(200, {
                        APIConnect: 'INVALID_REQUEST',
                        status: 'failed',
                        errorReason: 'refund_trans_id is required',
                    });
                }
                if ([...this.sslRefunds.values()].some(item => item.refundTransId === refundTransId)) {
                    return json(200, {
                        APIConnect: 'DONE',
                        status: 'failed',
                        errorReason: 'Duplicate refund_trans_id',
                    });
                }
                if (this.sslRefundAnswer === 'failed') {
                    return json(200, {
                        APIConnect: 'DONE',
                        status: 'failed',
                        errorReason: 'Insufficient balance for refund',
                    });
                }
                this.refunds.push({
                    gateway: 'sslcommerz',
                    ref: params.get('bank_tran_id')!,
                    amount: params.get('refund_amount')!,
                });
                const refId = `REF${this.refunds.length}`;
                this.sslRefunds.set(refId, {
                    bankTranId: params.get('bank_tran_id')!,
                    refundTransId,
                    amount: params.get('refund_amount')!,
                    refId,
                    status: this.sslRefundAnswer === 'processing' ? 'processing' : 'refunded',
                });
                return json(200, {
                    APIConnect: 'DONE',
                    status: this.sslRefundAnswer,
                    refund_ref_id: refId,
                });
            }
            if (params.get('refund_ref_id')) {
                const refund = this.sslRefunds.get(params.get('refund_ref_id')!);
                if (!refund)
                    return json(200, { APIConnect: 'DONE', status: 'cancelled', errorReason: 'Not found' });
                return json(200, {
                    APIConnect: 'DONE',
                    bank_tran_id: refund.bankTranId,
                    trans_id: refund.refundTransId,
                    refund_ref_id: refund.refId,
                    status: refund.status,
                });
            }
            const transaction = this.ssl.get(params.get('tran_id') ?? '');
            if (!transaction) return json(200, { APIConnect: 'DONE', no_of_trans_found: 0, element: [] });
            return json(200, {
                APIConnect: 'DONE',
                no_of_trans_found: 1,
                element: [
                    this.sslRecord(
                        transaction,
                        transaction.status === 'VALID' ? 'VALIDATED' : transaction.status,
                    ),
                ],
            });
        }
        json(404, { error: 'not found' });
    }

    private sslRecord(transaction: SslTransaction, status: string) {
        return {
            status,
            tran_id: this.sslOmitTranId ? undefined : transaction.tranId,
            val_id: transaction.valId,
            amount: transaction.paidAmount ?? transaction.amount,
            currency: transaction.currency ?? 'BDT',
            bank_tran_id: transaction.bankTranId,
            risk_level: transaction.risk ?? '0',
            risk_title: transaction.riskTitle ?? 'Safe',
        };
    }

    private handleBkash(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        url: URL,
        body: string,
        json: (status: number, value: unknown) => void,
    ) {
        const path = url.pathname.replace(/^\/bkash\//, '');
        const input = body ? (JSON.parse(body) as Record<string, string>) : {};
        if (path === 'auth/grant-token' || path === 'auth/refresh-token') {
            this.bkashTokenCalls.push(path === 'auth/grant-token' ? 'grant' : 'refresh');
            if (
                req.headers.username !== BKASH_CREDENTIALS.username ||
                req.headers.password !== BKASH_CREDENTIALS.password ||
                input.app_key !== BKASH_CREDENTIALS.appKey ||
                input.app_secret !== BKASH_CREDENTIALS.appSecret
            ) {
                return json(200, { statusCode: '9999', statusMessage: 'Invalid credentials' });
            }
            const idToken = `token-${++this.tokens}`;
            this.validTokens.add(idToken);
            return json(200, {
                statusCode: '0000',
                statusMessage: 'Successful',
                id_token: idToken,
                refresh_token: `refresh-${this.tokens}`,
                expires_in: 3600,
                token_type: 'Bearer',
            });
        }
        // The raw id_token: "Bearer …" is refused, like bKash's samples imply.
        if (
            !this.validTokens.has(String(req.headers.authorization ?? '')) ||
            req.headers['x-app-key'] !== BKASH_CREDENTIALS.appKey
        ) {
            return json(401, { message: 'Unauthorized' });
        }
        this.bkashCalls.push(path);
        if (path === 'payment/create') {
            // v2 has no `mode`, and takes the amount with two decimals.
            if ('mode' in input || !/^\d+\.\d{2}$/.test(input.amount ?? '')) {
                return json(200, bkashErrorBody('2080'));
            }
            const paymentId = `TR${randomBytes(8).toString('hex')}`;
            const payment: BkashPayment = {
                paymentId,
                invoice: input.merchantInvoiceNumber!,
                amount: input.amount!,
                callbackUrl: input.callbackURL!,
                payerReference: input.payerReference ?? '',
                signature: randomBytes(12).toString('hex'),
                status: 'Initiated',
                onExecute: 'complete',
                executes: 0,
                refunds: [],
            };
            this.bkash.set(paymentId, payment);
            return json(200, {
                paymentId,
                bKashURL: `${this.url}/bkash/pay/${paymentId}`,
                callbackURL: payment.callbackUrl,
                successCallbackURL: `${payment.callbackUrl}?paymentID=${paymentId}&status=success`,
                transactionStatus: 'Initiated',
                amount: payment.amount,
                currency: 'BDT',
                intent: 'sale',
                merchantInvoiceNumber: payment.invoice,
                signature: payment.signature,
            });
        }
        if (path === 'general/search-transaction') {
            const found = [...this.bkash.values()].find(item => item.trxId && item.trxId === input.trxId);
            if (!found) return json(200, bkashErrorBody('2002'));
            return json(200, {
                trxId: found.trxId,
                transactionStatus: found.status,
                amount: found.amount,
                currency: 'BDT',
                payerAccount: '01712345678',
                completedTime: '2026-10-25T12:31:28:970 GMT+0600',
            });
        }
        const payment = this.bkash.get(input.paymentId ?? '');
        if (!payment) return json(200, bkashErrorBody('2002'));
        const record = () => ({
            paymentId: payment.paymentId,
            trxId: payment.trxId,
            transactionStatus: payment.status,
            verificationStatus: payment.status === 'Completed' ? 'Complete' : 'Incomplete',
            amount: payment.amount,
            currency: 'BDT',
            intent: 'sale',
            merchantInvoice: payment.invoice,
            payerAccount: payment.status === 'Completed' ? '01712345678' : undefined,
            maxRefundableAmount: payment.status === 'Completed' ? payment.maxRefundable : undefined,
        });
        if (path === 'payment/execute') {
            payment.executes++;
            // A paymentId can't be used again after any execute.
            if (payment.executes > 1) return json(200, bkashErrorBody('2117'));
            if (payment.onExecute === 'complete' || payment.onExecute === 'drop') {
                payment.status = 'Completed';
                payment.trxId = `TRX${randomBytes(4).toString('hex').toUpperCase()}`;
                payment.maxRefundable = this.bkashMaxRefundable ?? payment.amount;
                // bKash's known failure: the money is taken, the answer never arrives.
                if (payment.onExecute === 'drop') return req.socket.destroy();
                return json(200, record());
            }
            // Refused (wrong PIN, no balance…): the payment stays Initiated and can't complete.
            return json(200, bkashErrorBody(payment.onExecute));
        }
        if (path === 'query/payment') return json(200, record());
        if (path === 'refund/payment/transaction') {
            if (input.trxId !== payment.trxId || payment.status !== 'Completed') {
                return json(200, bkashErrorBody('2080'));
            }
            const refunded = payment.refunds.reduce((sum, item) => sum + Number(item.amount), 0);
            if (Number(input.refundAmount) > Number(payment.maxRefundable ?? payment.amount) - refunded) {
                return json(200, bkashErrorBody('2072'));
            }
            if (payment.refunds.some(item => Date.now() - item.at < 10 * 60_000)) {
                return json(200, bkashErrorBody('2073'));
            }
            const refundTrxId = `RF${payment.refunds.length + 1}${randomBytes(3).toString('hex').toUpperCase()}`;
            payment.refunds.push({ refundTrxId, amount: input.refundAmount!, at: Date.now() });
            this.refunds.push({ gateway: 'bkash', ref: input.trxId!, amount: input.refundAmount! });
            if (this.bkashRefund === 'drop') return req.socket.destroy();
            return json(200, {
                originalTrxId: payment.trxId,
                refundTrxId,
                refundTransactionStatus: 'Completed',
                originalTrxAmount: payment.amount,
                refundAmount: input.refundAmount,
                currency: 'BDT',
            });
        }
        if (path === 'refund/payment/status') {
            return json(200, {
                originalTrxId: payment.trxId,
                originalTrxAmount: payment.amount,
                refundTransactions: payment.refunds.map(item => ({
                    refundTrxId: item.refundTrxId,
                    refundTransactionStatus: 'Completed',
                    refundAmount: item.amount,
                })),
            });
        }
        json(404, bkashErrorBody('2080'));
    }
}

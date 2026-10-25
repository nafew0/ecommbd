import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

/**
 * A stand-in for SSLCommerz and bKash (phase 18), for end-to-end tests: the same endpoints and
 * answers as the gateways' documented APIs, with switches for every edge case (refusals, wrong
 * amounts, risky cards, a dropped connection on execute). bKash lives under `/bkash`.
 *
 * SSLCommerz's own rules are enforced: a tran_id of at most 30 characters, a cus_postcode, ৳10 to
 * ৳5,00,000, and a unique refund_trans_id on every refund (since February 2025).
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
    status: 'Initiated' | 'Completed' | 'Failed' | 'Cancelled';
    trxId?: string;
    /** What execute does: complete, refuse with a code, or drop the connection after taking the money. */
    onExecute: 'complete' | 'drop' | string;
}

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
    sslSessions = 0;
    private server?: http.Server;
    private tokens = 0;

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
        const path = url.pathname.replace(/^\/bkash\/tokenized\/checkout\//, '');
        const input = body ? (JSON.parse(body) as Record<string, string>) : {};
        if (path === 'token/grant' || path === 'token/refresh') {
            if (
                req.headers.username !== BKASH_CREDENTIALS.username ||
                req.headers.password !== BKASH_CREDENTIALS.password
            ) {
                return json(200, { statusCode: '2001', statusMessage: 'Invalid App Key' });
            }
            return json(200, {
                statusCode: '0000',
                id_token: `token-${++this.tokens}`,
                refresh_token: `refresh-${this.tokens}`,
                expires_in: 3600,
                token_type: 'Bearer',
            });
        }
        if (!String(req.headers.authorization ?? '').startsWith('token-'))
            return json(401, { message: 'Unauthorized' });
        if (path === 'create') {
            const paymentId = `TR${randomBytes(8).toString('hex')}`;
            this.bkash.set(paymentId, {
                paymentId,
                invoice: input.merchantInvoiceNumber,
                amount: input.amount,
                callbackUrl: input.callbackURL,
                status: 'Initiated',
                onExecute: 'complete',
            });
            return json(200, {
                statusCode: '0000',
                statusMessage: 'Successful',
                paymentID: paymentId,
                bkashURL: `${this.url}/bkash/pay/${paymentId}`,
                transactionStatus: 'Initiated',
                amount: input.amount,
                merchantInvoiceNumber: input.merchantInvoiceNumber,
            });
        }
        const payment = this.bkash.get(input.paymentID ?? '');
        if (!payment) return json(200, { statusCode: '2002', statusMessage: 'Invalid Payment ID' });
        const record = () => ({
            statusCode: '0000',
            statusMessage: 'Successful',
            paymentID: payment.paymentId,
            trxID: payment.trxId,
            transactionStatus: payment.status,
            amount: payment.amount,
            currency: 'BDT',
            merchantInvoiceNumber: payment.invoice,
        });
        if (path === 'execute') {
            if (payment.onExecute === 'complete' || payment.onExecute === 'drop') {
                payment.status = 'Completed';
                payment.trxId = `TRX${randomBytes(4).toString('hex').toUpperCase()}`;
                // bKash's known failure: the money is taken, the answer never arrives.
                if (payment.onExecute === 'drop') return req.socket.destroy();
                return json(200, record());
            }
            payment.status = 'Failed';
            return json(200, { statusCode: payment.onExecute, statusMessage: 'Refused' });
        }
        if (path === 'payment/status') return json(200, record());
        if (path === 'payment/refund') {
            this.refunds.push({ gateway: 'bkash', ref: input.trxID, amount: input.amount });
            return json(200, {
                statusCode: '0000',
                transactionStatus: 'Completed',
                refundTrxID: `RF${this.refunds.length}`,
                originalTrxID: input.trxID,
                amount: input.amount,
            });
        }
        json(404, { statusCode: '9999' });
    }
}

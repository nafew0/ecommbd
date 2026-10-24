import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

/**
 * A stand-in for SSLCommerz and bKash (phase 18), for end-to-end tests: the same endpoints and
 * answers as the gateways' documented APIs, with switches for every edge case (refusals, wrong
 * amounts, risky cards, a dropped connection on execute). bKash lives under `/bkash`.
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
    /** Answer every SSLCommerz session request with this HTTP status (e.g. 503). */
    sslSessionStatus = 200;
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
        options: { amount?: string; currency?: string; risk?: '0' | '1'; fail?: boolean } = {},
    ) {
        const transaction = this.ssl.get(tranId);
        if (!transaction) throw new Error(`No SSLCommerz session for ${tranId}`);
        transaction.status = options.fail ? 'FAILED' : 'VALID';
        transaction.valId = `VAL${randomBytes(6).toString('hex')}`;
        transaction.bankTranId = `BANK${randomBytes(4).toString('hex')}`;
        transaction.paidAmount = options.amount ?? transaction.amount;
        transaction.currency = options.currency ?? 'BDT';
        transaction.risk = options.risk ?? '0';
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
            if (!sslAuthorized(form.get('store_id'), form.get('store_passwd'))) {
                return json(200, {
                    status: 'FAILED',
                    failedreason: 'Store Credential Error Or Store is De-active',
                });
            }
            const tranId = form.get('tran_id')!;
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
            if (!transaction || transaction.status !== 'VALID')
                return json(200, { status: 'INVALID_TRANSACTION' });
            return json(200, this.sslRecord(transaction, 'VALID'));
        }
        if (url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
            if (!sslAuthorized(params.get('store_id'), params.get('store_passwd')))
                return json(200, { APIConnect: 'INVALID_REQUEST' });
            if (params.get('bank_tran_id')) {
                this.refunds.push({
                    gateway: 'sslcommerz',
                    ref: params.get('bank_tran_id')!,
                    amount: params.get('refund_amount')!,
                });
                return json(200, {
                    APIConnect: 'DONE',
                    status: 'success',
                    refund_ref_id: `REF${this.refunds.length}`,
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
            tran_id: transaction.tranId,
            val_id: transaction.valId,
            amount: transaction.paidAmount ?? transaction.amount,
            currency: transaction.currency ?? 'BDT',
            bank_tran_id: transaction.bankTranId,
            risk_level: transaction.risk ?? '0',
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

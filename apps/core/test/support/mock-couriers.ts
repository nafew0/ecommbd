import { randomBytes } from 'node:crypto';
import http from 'node:http';

/**
 * A stand-in for Steadfast and Pathao (phase 19) for end-to-end tests: their documented endpoints
 * and answers, with switches for refusals, an expired token, and status changes. Pathao is under
 * `/pathao`, Steadfast under `/steadfast`.
 */

export const STEADFAST_CREDENTIALS = { apiKey: 'sf-key', secretKey: 'sf-secret' };
export const PATHAO_CREDENTIALS = {
    clientId: 'pc-id',
    clientSecret: 'pc-secret',
    username: 'merchant@example.com',
    password: 'pw',
};

export interface MockParcel {
    courier: 'steadfast' | 'pathao';
    consignmentId: string;
    invoice: string;
    body: Record<string, unknown>;
    status: string;
}

export class MockCouriers {
    readonly parcels = new Map<string, MockParcel>();
    /** Phones (01…) the couriers refuse, like an invalid number. */
    readonly refusePhones = new Set<string>();
    /** The next Pathao calls answer 401 once (an expired token). */
    expirePathaoToken = false;
    tokensIssued = 0;
    private server?: http.Server;
    private nextId = 1000;

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

    byInvoice(invoice: string): MockParcel | undefined {
        return [...this.parcels.values()].find(parcel => parcel.invoice === invoice);
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
        const json = (status: number, value: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        const url = new URL(req.url ?? '/', this.url);
        const input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        if (url.pathname.startsWith('/steadfast/')) {
            if (
                req.headers['api-key'] !== STEADFAST_CREDENTIALS.apiKey ||
                req.headers['secret-key'] !== STEADFAST_CREDENTIALS.secretKey
            ) {
                return json(401, { status: 401, message: 'Unauthorized' });
            }
            const path = url.pathname.replace('/steadfast/', '');
            if (path === 'get_balance') return json(200, { status: 200, current_balance: 0 });
            if (path === 'create_order') {
                if (this.refusePhones.has(String(input.recipient_phone))) {
                    return json(422, {
                        status: 400,
                        errors: { recipient_phone: ['The recipient phone is invalid.'] },
                    });
                }
                const id = String(this.nextId++);
                const parcel: MockParcel = {
                    courier: 'steadfast',
                    consignmentId: id,
                    invoice: String(input.invoice),
                    body: input,
                    status: 'in_review',
                };
                this.parcels.set(`steadfast:${id}`, parcel);
                return json(200, {
                    status: 200,
                    message: 'Consignment has been created successfully.',
                    consignment: {
                        consignment_id: Number(id),
                        invoice: input.invoice,
                        tracking_code: `SF${id}`,
                        status: 'in_review',
                    },
                });
            }
            const match = /^status_by_cid\/(\w+)$/.exec(path);
            if (match) {
                const parcel = this.parcels.get(`steadfast:${match[1]}`);
                return parcel
                    ? json(200, { status: 200, delivery_status: parcel.status })
                    : json(404, { status: 404 });
            }
            return json(404, {});
        }

        if (url.pathname.startsWith('/pathao/aladdin/api/v1/')) {
            const path = url.pathname.replace('/pathao/aladdin/api/v1/', '');
            if (path === 'issue-token') {
                const ok =
                    input.client_id === PATHAO_CREDENTIALS.clientId &&
                    input.client_secret === PATHAO_CREDENTIALS.clientSecret &&
                    (input.grant_type === 'refresh_token' || input.password === PATHAO_CREDENTIALS.password);
                if (!ok) return json(401, { message: 'Invalid credentials' });
                this.tokensIssued++;
                return json(200, {
                    token_type: 'Bearer',
                    expires_in: 432000,
                    access_token: `pat-${randomBytes(4).toString('hex')}`,
                    refresh_token: 'refresh',
                });
            }
            if (!String(req.headers.authorization ?? '').startsWith('Bearer pat-'))
                return json(401, { message: 'Unauthenticated' });
            if (this.expirePathaoToken) {
                this.expirePathaoToken = false;
                return json(401, { message: 'Unauthenticated' });
            }
            if (path === 'countries/1/city-list') {
                return json(200, {
                    code: 200,
                    data: {
                        data: [
                            { city_id: 1, city_name: 'Dhaka' },
                            { city_id: 2, city_name: 'Chittagong' },
                        ],
                    },
                });
            }
            const zones = /^cities\/(\d+)\/zone-list$/.exec(path);
            if (zones) {
                const list =
                    zones[1] === '1'
                        ? [
                              { zone_id: 11, zone_name: 'Mirpur' },
                              { zone_id: 12, zone_name: 'Dhanmondi' },
                              { zone_id: 13, zone_name: 'Gulshan' },
                          ]
                        : [{ zone_id: 21, zone_name: 'Kotwali' }];
                return json(200, { code: 200, data: { data: list } });
            }
            if (path === 'stores')
                return json(200, {
                    code: 200,
                    data: { data: [{ store_id: 555, store_name: 'Main store' }] },
                });
            if (path === 'orders' && req.method === 'POST') {
                if (this.refusePhones.has(String(input.recipient_phone))) {
                    return json(422, {
                        code: 422,
                        message: 'Please fix the given errors',
                        errors: { recipient_phone: ['The recipient phone format is invalid.'] },
                    });
                }
                const id = `DL${this.nextId++}PATH`;
                this.parcels.set(`pathao:${id}`, {
                    courier: 'pathao',
                    consignmentId: id,
                    invoice: String(input.merchant_order_id),
                    body: input,
                    status: 'Pending',
                });
                return json(200, {
                    code: 200,
                    message: 'Order Created Successfully',
                    data: {
                        consignment_id: id,
                        merchant_order_id: input.merchant_order_id,
                        order_status: 'Pending',
                        delivery_fee: 60,
                    },
                });
            }
            const info = /^orders\/(\w+)\/info$/.exec(path);
            if (info) {
                const parcel = this.parcels.get(`pathao:${info[1]}`);
                return parcel
                    ? json(200, {
                          code: 200,
                          data: {
                              consignment_id: parcel.consignmentId,
                              order_status_slug: parcel.status,
                              updated_at: new Date().toISOString(),
                          },
                      })
                    : json(404, { code: 404 });
            }
            return json(404, {});
        }
        json(404, {});
    }
}

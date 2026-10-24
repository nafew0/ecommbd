import { createHash } from 'node:crypto';
import http from 'node:http';
import { defaultMetaSettings, type MetaSettings } from '@ecommbd/shared';
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaService } from '../../src/plugins/meta-capi';
import { prepareCheckout, TRANSITION } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

/** A stand-in for Meta's Graph API: records each batch; a "revoked" token or a "bad" event is refused. */
class MockGraph {
    readonly requests: Array<{
        pixelId: string;
        body: { data: Array<Record<string, unknown>>; access_token: string; test_event_code?: string };
    }> = [];
    private server?: http.Server;
    constructor(readonly port: number) {}
    get url() {
        return `http://127.0.0.1:${this.port}`;
    }
    start() {
        this.server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', chunk => (raw += chunk));
            req.on('end', () => {
                const match = /^\/v26\.0\/(\d+)\/events$/.exec(req.url ?? '');
                const json = (status: number, value: unknown) => {
                    res.writeHead(status, { 'content-type': 'application/json' });
                    res.end(JSON.stringify(value));
                };
                if (!match) return json(404, {});
                const body = JSON.parse(raw);
                this.requests.push({ pixelId: match[1]!, body });
                if (body.access_token === 'revoked')
                    return json(400, { error: { code: 190, message: 'Error validating access token' } });
                if (body.data.some((event: { event_id: string }) => event.event_id.startsWith('bad'))) {
                    return json(400, { error: { code: 100, message: 'Invalid parameter' } });
                }
                json(200, { events_received: body.data.length, messages: [], fbtrace_id: 'TRACE123' });
            });
        });
        return new Promise<void>(resolve => this.server!.listen(this.port, '127.0.0.1', () => resolve()));
    }
    stop() {
        return new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    }
}

const PORT = 3075;
const graph = new MockGraph(4075);
const config = createTestConfig(PORT, {}, { metaGraphUrl: graph.url });
const { server, adminClient, shopClient } = createTestEnvironment(config);
const core = `http://localhost:${PORT}`;
const PIXELS = ['1111111111', '2222222222'];
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/129.0 Mobile Safari/537.36';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const UPDATE = gql`
    mutation ($input: JSON!) {
        updateBdMetaSettings(input: $input) {
            errors {
                path
                code
            }
        }
    }
`;
const TOKEN = gql`
    mutation ($pixelId: String!, $token: String!) {
        saveBdMetaToken(pixelId: $pixelId, token: $token) {
            path
        }
    }
`;
const SETUP = gql`
    query {
        bdMetaSetup {
            pixels {
                pixelId
                tokenSaved
            }
            tokenProblem {
                pixelId
                message
            }
            graphVersion
        }
    }
`;
const EVENTS = gql`
    query ($eventName: String, $status: String) {
        bdMetaEvents(eventName: $eventName, status: $status, take: 100) {
            totalItems
            items {
                pixelId
                eventName
                eventId
                source
                status
                payload
                response
                error
                orderId
            }
        }
    }
`;
const TEST_EVENT = gql`
    mutation ($pixelId: String!) {
        sendBdMetaTestEvent(pixelId: $pixelId) {
            ok
            eventsReceived
            fbtraceId
        }
    }
`;
const CONFIG = gql`
    query {
        bdMetaConfig {
            pixelIds
            browserPixel
            purchaseTrigger
        }
    }
`;
const SET_BROWSER = gql`
    mutation ($input: BdMetaBrowserInput!) {
        setBdMetaBrowser(input: $input)
    }
`;
const ADD_PAYMENT = gql`
    mutation {
        addPaymentToOrder(input: { method: "bd-cod", metadata: {} }) {
            ... on Order {
                id
                code
                state
            }
            ... on ErrorResult {
                message
            }
        }
    }
`;
const action = (name: string, inputType: string) => gql`
    mutation ($input: ${inputType}!) {
        ${name}(input: $input) {
            ... on Order { id state }
            ... on BdOrderActionError { reason message }
        }
    }
`;
const CONFIRM = action('confirmBdOrder', 'BdConfirmOrderInput');
const PACK = action('packBdOrder', 'BdOrderActionInput');
const SHIP = action('markBdOrderShipped', 'BdOrderActionInput');
const DELIVER = action('markBdOrderDelivered', 'BdOrderActionInput');

const db = () => server.app.get(TransactionalConnection).rawConnection;
const meta = () => server.app.get(MetaService);
const n = (id: string) => Number(String(id).replace(/^T_/, ''));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function settings(patch: Partial<MetaSettings> = {}) {
    const { updateBdMetaSettings } = await adminClient.query(UPDATE, {
        input: { ...defaultMetaSettings(), enabled: true, pixelIds: PIXELS, ...patch },
    });
    expect(updateBdMetaSettings.errors).toEqual([]);
}

const events = async (variables: { eventName?: string; status?: string } = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL JSON in a test.
    (await adminClient.query(EVENTS, variables)).bdMetaEvents.items as Array<Record<string, any>>;

function browserEvent(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return fetch(`${core}/bd-events`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': UA,
            'sec-fetch-site': 'same-origin',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

let phoneSuffix = 7000;
/** A COD order placed from the storefront, with Meta's cookies saved at checkout. */
async function placedOrder() {
    await shopClient.asAnonymousUser();
    phoneSuffix += 1;
    const phone = `0171500${phoneSuffix}`;
    await prepareCheckout(shopClient, { phone, name: 'Rahim Uddin' });
    await shopClient.query(SET_BROWSER, {
        input: { fbp: 'fb.1.1729750000000.1234567890', fbc: 'fb.1.1729750000000.IwAR2abc', userAgent: UA },
    });
    await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
    const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT);
    expect(addPaymentToOrder.state).toBe('PaymentAuthorized');
    await wait(300);
    return { id: addPaymentToOrder.id as string, code: addPaymentToOrder.code as string, phone };
}

const purchasesOf = async (code: string) =>
    (await events({ eventName: 'Purchase' })).filter(event => event.eventId === `purchase-${code}`);

beforeAll(async () => {
    await graph.start();
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    await settings();
    for (const pixelId of PIXELS) await adminClient.query(TOKEN, { pixelId, token: `token-${pixelId}` });
}, 120_000);

afterAll(async () => {
    await server.destroy();
    await graph.stop();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await settings();
    await db().query(`DELETE FROM bd_meta_event`);
    graph.requests.length = 0;
});

describe('setup', () => {
    it('keeps tokens write-only and tells the storefront only what it needs', async () => {
        const { bdMetaSetup } = await adminClient.query(SETUP);
        expect(bdMetaSetup).toMatchObject({ graphVersion: 'v26.0', tokenProblem: null });
        expect(bdMetaSetup.pixels).toEqual(PIXELS.map(pixelId => ({ pixelId, tokenSaved: true })));
        const rows = await db().query(
            `SELECT value::text FROM settings_store_entry WHERE key = 'metaCapi.tokens'`,
        );
        expect(JSON.stringify(rows)).not.toContain('token-1111111111');
        expect((await shopClient.query(CONFIG)).bdMetaConfig).toEqual({
            pixelIds: PIXELS,
            browserPixel: true,
            purchaseTrigger: 'confirmed',
        });
        await settings({ enabled: false });
        expect((await shopClient.query(CONFIG)).bdMetaConfig.pixelIds).toEqual([]);
    });

    it('sends a test event straight to Meta', async () => {
        await settings({ testEventCode: 'TEST123' });
        const result = (await adminClient.query(TEST_EVENT, { pixelId: PIXELS[0] })).sendBdMetaTestEvent;
        expect(result).toEqual({ ok: true, eventsReceived: 1, fbtraceId: 'TRACE123' });
        expect(graph.requests[0]!.body.test_event_code).toBe('TEST123');
    });
});

describe('browser events', () => {
    const view = {
        event: 'ViewContent',
        eventId: 'abcdef0123456789abcdef01',
        url: 'https://shop.example.com/product/panjabi/',
        fbp: 'fb.1.1729750000000.1234567890',
        data: { content_ids: ['12'], content_type: 'product', value: 1250, currency: 'BDT' },
    };

    it('queues a checked event for each Pixel and sends it with Meta’s answer', async () => {
        expect((await browserEvent(view)).status).toBe(204);
        let queued = await events();
        expect(queued.map(event => event.pixelId).sort()).toEqual(PIXELS);
        expect(queued[0]).toMatchObject({ eventName: 'ViewContent', source: 'browser', status: 'queued' });
        // A retried beacon with the same ID is one event.
        await browserEvent(view);
        expect(await events()).toHaveLength(2);

        expect(await meta().send()).toBe(2);
        const sent = graph.requests.find(request => request.pixelId === PIXELS[0])!.body.data[0]!;
        expect(sent).toMatchObject({
            event_name: 'ViewContent',
            event_id: view.eventId,
            action_source: 'website',
            user_data: { fbp: view.fbp, client_user_agent: UA, client_ip_address: expect.any(String) },
            custom_data: { content_ids: ['12'], value: 1250, currency: 'BDT' },
        });
        queued = await events();
        expect(queued[0]).toMatchObject({
            status: 'sent',
            response: { events_received: 1, fbtrace_id: 'TRACE123' },
        });
        // The client's IP and browser are not kept once sent.
        const [row] = await db().query(`SELECT "clientIp", "userAgent" FROM bd_meta_event LIMIT 1`);
        expect(row).toEqual({ clientIp: null, userAgent: null });
    });

    it('ignores bots, other sites, other stores, bad data and Purchase from the browser', async () => {
        await browserEvent(view, { 'user-agent': 'Googlebot/2.1' });
        await browserEvent(view, { 'sec-fetch-site': 'cross-site' });
        await browserEvent({ ...view, url: 'https://evil.example.org/' });
        await browserEvent({ ...view, data: { value: -1 } });
        await browserEvent({ ...view, data: { secret: 'x' } });
        await browserEvent({ ...view, event: 'Purchase' });
        await browserEvent({ ...view, fbp: 'not-a-cookie' });
        expect(await events()).toEqual([]);
        await settings({ enabled: false });
        await browserEvent(view);
        expect(await events()).toEqual([]);
    });
});

describe('sending', () => {
    const page = (eventId: string) => ({ event: 'PageView', eventId, url: 'https://shop.example.com/' });

    it('pauses on a revoked token, tells staff, and keeps the events', async () => {
        await adminClient.query(TOKEN, { pixelId: PIXELS[0], token: 'revoked' });
        await browserEvent(page('revoked000000000001'));
        await meta().send();
        const { bdMetaSetup } = await adminClient.query(SETUP);
        expect(bdMetaSetup.tokenProblem).toMatchObject({
            pixelId: PIXELS[0],
            message: expect.stringContaining('190'),
        });
        const first = (await events()).find(event => event.pixelId === PIXELS[0])!;
        expect(first.status).toBe('queued');
        // A new token: sending works again and the warning goes away.
        await adminClient.query(TOKEN, { pixelId: PIXELS[0], token: `token-${PIXELS[0]}` });
        await db().query(`UPDATE bd_meta_event SET "nextAttemptAt" = now()`);
        await meta().send();
        expect((await events()).every(event => event.status === 'sent')).toBe(true);
        expect((await adminClient.query(SETUP)).bdMetaSetup.tokenProblem).toBeNull();
    });

    it('finds the one bad event in a batch and sends the rest', async () => {
        await browserEvent(page('good00000000000001'));
        await browserEvent(page('bad000000000000001'));
        await browserEvent(page('good00000000000002'));
        await meta().send();
        const rows = (await events()).filter(event => event.pixelId === PIXELS[0]);
        expect(Object.fromEntries(rows.map(event => [event.eventId, event.status]))).toEqual({
            good00000000000001: 'sent',
            bad000000000000001: 'failed',
            good00000000000002: 'sent',
        });
    });

    it('skips events Meta no longer takes (older than 7 days)', async () => {
        await browserEvent(page('old000000000000001'));
        await db().query(`UPDATE bd_meta_event SET "eventTime" = now() - interval '8 days'`);
        await meta().send();
        expect((await events()).every(event => event.status === 'skipped')).toBe(true);
        expect(graph.requests).toEqual([]);
    });
});

describe('Purchase', () => {
    it('with "confirmed": nothing on placing, one hashed Purchase when staff confirm', async () => {
        const order = await placedOrder();
        expect(await purchasesOf(order.code)).toEqual([]);
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        await wait(300);
        const purchases = await purchasesOf(order.code);
        expect(purchases).toHaveLength(2);
        const payload = purchases[0]!.payload;
        expect(payload.user_data).toMatchObject({
            ph: [sha(`880${order.phone.slice(1)}`)],
            fn: [sha('rahim')],
            ln: [sha('uddin')],
            ct: [sha('dhaka')],
            country: [sha('bd')],
            fbp: 'fb.1.1729750000000.1234567890',
            fbc: 'fb.1.1729750000000.IwAR2abc',
        });
        // No raw phone or placeholder email anywhere in what's kept.
        expect(JSON.stringify(payload)).not.toContain(order.phone.slice(1));
        expect(payload.user_data.em).toBeUndefined();
        expect(payload.custom_data).toMatchObject({
            currency: 'BDT',
            value: 1250,
            content_type: 'product',
            num_items: 1,
        });
        await meta().send();
        const sent = graph.requests
            .flatMap(request => request.body.data)
            .find(event => event.event_id === `purchase-${order.code}`)!;
        expect(sent.user_data).toMatchObject({
            client_user_agent: UA,
            client_ip_address: expect.any(String),
        });
    });

    it('with "placed": sent at once; with "delivered": only on delivery', async () => {
        await settings({ purchaseTrigger: 'placed', purchaseValue: 'withDelivery' });
        const placed = await placedOrder();
        const [purchase] = await purchasesOf(placed.code);
        expect(purchase!.payload.custom_data.value).toBe(1310);

        await settings({ purchaseTrigger: 'delivered' });
        const delivered = await placedOrder();
        for (const mutation of [CONFIRM, PACK, SHIP])
            await adminClient.query(mutation, { input: { orderId: delivered.id } });
        await wait(300);
        expect(await purchasesOf(delivered.code)).toEqual([]);
        await adminClient.query(DELIVER, { input: { orderId: delivered.id } });
        await wait(300);
        expect(await purchasesOf(delivered.code)).toHaveLength(2);
    });

    it('never for imported orders; manual orders only when the store says so', async () => {
        const imported = await placedOrder();
        await db().query(`UPDATE "order" SET "customFieldsImported" = true WHERE id = $1`, [n(imported.id)]);
        await adminClient.query(CONFIRM, { input: { orderId: imported.id } });
        const manual = await placedOrder();
        await db().query(`UPDATE "order" SET "customFieldsSource" = 'phone' WHERE id = $1`, [n(manual.id)]);
        await adminClient.query(CONFIRM, { input: { orderId: manual.id } });
        await wait(300);
        expect(await purchasesOf(imported.code)).toEqual([]);
        expect(await purchasesOf(manual.code)).toEqual([]);
        await settings({ sendManualOrders: true });
        await meta().purchase(await meta().background(), n(manual.id), 'confirmed');
        expect(await purchasesOf(manual.code)).toHaveLength(2);
    });
});

describe('permissions', () => {
    it('keeps settings, tokens and the event log for staff', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(SETUP)).rejects.toThrow();
        await expect(adminClient.query(EVENTS)).rejects.toThrow();
        await expect(adminClient.query(TOKEN, { pixelId: PIXELS[0], token: 'x' })).rejects.toThrow();
    });
});

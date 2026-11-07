import { createHash } from 'node:crypto';
import http from 'node:http';
import { defaultMetaSettings, type MetaSettings } from '@ecommbd/shared';
import {
    EventBus,
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    TransactionalConnection,
} from '@vendure/core';
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

/**
 * A stand-in for Meta's Graph API: records each batch. Tokens choose the answer: "revoked" (code 190),
 * "noperm" (code 200, the Pixel refused), "busy" (HTTP 429) and "down" (HTTP 500); an event whose ID
 * starts with "bad" makes Meta refuse the batch (code 100).
 */
class MockGraph {
    /** Pixels refused as a whole (code 200, a token without permission), whatever the token. */
    readonly refusedPixels = new Set<string>();
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
                if (body.access_token === 'noperm' || this.refusedPixels.has(match[1]!))
                    return json(403, { error: { code: 200, message: 'Permissions error' } });
                if (body.access_token === 'busy')
                    return json(429, { error: { code: 4, message: 'Too many calls' } });
                if (body.access_token === 'down')
                    return json(500, { error: { message: 'Service unavailable' } });
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
            holds {
                pixelId
                kind
                message
            }
            graphVersion
        }
    }
`;
const EVENTS = gql`
    query ($eventName: String, $status: String, $order: String, $skip: Int, $take: Int) {
        bdMetaEvents(eventName: $eventName, status: $status, order: $order, skip: $skip, take: $take) {
            totalItems
            items {
                id
                pixelId
                eventName
                eventId
                source
                status
                payload
                response
                error
                orderId
                attempts
            }
        }
    }
`;
const TEST_EVENT = gql`
    mutation ($pixelId: String!) {
        sendBdMetaTestEvent(pixelId: $pixelId) {
            ok
            code
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

const events = async (
    variables: { eventName?: string; status?: string; order?: string; skip?: number; take?: number } = {},
) =>
    // The event log's rows, as GraphQL JSON: fields are read by name in the tests.
    (await adminClient.query(EVENTS, { take: 100, ...variables })).bdMetaEvents.items as EventRow[];

/** One event log row as the tests read it (GraphQL JSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON in a test.
type EventRow = Record<string, any>;

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
    // Fresh tokens: releases any hold a test left behind.
    for (const pixelId of PIXELS) await adminClient.query(TOKEN, { pixelId, token: `token-${pixelId}` });
    graph.refusedPixels.clear();
    graph.requests.length = 0;
});

describe('setup', () => {
    it('keeps tokens write-only and tells the storefront only what it needs', async () => {
        const { bdMetaSetup } = await adminClient.query(SETUP);
        expect(bdMetaSetup).toMatchObject({ graphVersion: 'v26.0', holds: [] });
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

    it('sends a test event straight to Meta, only with a test event code', async () => {
        // Without a code it would count as a real PageView in the live dataset: refused.
        const refused = (await adminClient.query(TEST_EVENT, { pixelId: PIXELS[0] })).sendBdMetaTestEvent;
        expect(refused).toMatchObject({ ok: false, code: 'noTestCode' });
        expect(graph.requests).toEqual([]);
        await settings({ testEventCode: 'TEST123' });
        const result = (await adminClient.query(TEST_EVENT, { pixelId: PIXELS[0] })).sendBdMetaTestEvent;
        expect(result).toEqual({ ok: true, code: null, eventsReceived: 1, fbtraceId: 'TRACE123' });
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

    it('keeps secrets out of the page address and never tracks private pages', async () => {
        await browserEvent({
            ...view,
            url: 'https://shop.example.com/checkout/thank-you/?order=ABC123XYZ&utm_source=fb#x',
        });
        const [stored] = await events();
        expect(stored!.payload.event_source_url).toBe(
            'https://shop.example.com/checkout/thank-you/?utm_source=fb',
        );
        await db().query(`DELETE FROM bd_meta_event`);
        // The SMS tracking link and the payment hand-off: nothing queued at all.
        await browserEvent({
            ...view,
            eventId: 'private000000000001',
            url: 'https://shop.example.com/t/SECRET123/',
        });
        await browserEvent({
            ...view,
            eventId: 'private000000000002',
            url: 'https://shop.example.com/checkout/pay/?to=x',
        });
        expect(await events()).toEqual([]);
    });

    it('refuses a body over 8 KB before parsing it', async () => {
        // Valid apart from its size (unknown fields are dropped by the schema): only the limit stops it.
        const response = await browserEvent({ ...view, padding: 'x'.repeat(9_000) });
        expect(response.status).toBe(204);
        expect(await events()).toEqual([]);
        await browserEvent(view);
        expect(await events()).toHaveLength(2);
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

    const requestsTo = (pixelId: string) => graph.requests.filter(request => request.pixelId === pixelId);
    const holds = async () =>
        (await adminClient.query(SETUP)).bdMetaSetup.holds as Array<Record<string, string>>;

    it('holds a Pixel on a revoked token until a new token is saved, and tells staff', async () => {
        await adminClient.query(TOKEN, { pixelId: PIXELS[0], token: 'revoked' });
        await browserEvent(page('revoked000000000001'));
        await meta().send();
        expect(await holds()).toEqual([
            { pixelId: PIXELS[0], kind: 'token', message: expect.stringContaining('190') },
        ]);
        // Held means held: later events and later runs send nothing for that Pixel.
        await browserEvent(page('revoked000000000002'));
        await meta().send();
        expect(requestsTo(PIXELS[0])).toHaveLength(1);
        const waiting = (await events()).filter(event => event.pixelId === PIXELS[0]);
        expect(waiting.map(event => [event.status, event.attempts])).toEqual([
            ['queued', 0],
            ['queued', 0],
        ]);
        // A new token releases them at once, and clears only this Pixel's warning.
        await adminClient.query(TOKEN, { pixelId: PIXELS[1], token: 'noperm' });
        await browserEvent(page('revoked000000000003'));
        await meta().send();
        expect((await holds()).map(hold => hold.pixelId).sort()).toEqual(PIXELS);
        await adminClient.query(TOKEN, { pixelId: PIXELS[0], token: `token-${PIXELS[0]}` });
        expect((await holds()).map(hold => hold.pixelId)).toEqual([PIXELS[1]]);
        await meta().send();
        const rows = await events();
        expect(
            rows.filter(event => event.pixelId === PIXELS[0]).every(event => event.status === 'sent'),
        ).toBe(true);
        // The other Pixel is still held: its event since the hold waits.
        const other = rows.find(
            event => event.pixelId === PIXELS[1] && event.eventId === 'revoked000000000003',
        );
        expect(other!.status).toBe('queued');
    });

    it('holds a Pixel Meta refuses as a whole, without sending event by event', async () => {
        graph.refusedPixels.add(PIXELS[0]);
        for (let i = 1; i <= 5; i++) await browserEvent(page(`noperm00000000000${i}`));
        await meta().send();
        // One request, not one per event, and no event marked failed.
        expect(requestsTo(PIXELS[0])).toHaveLength(1);
        expect(await holds()).toEqual([
            { pixelId: PIXELS[0], kind: 'pixel', message: expect.stringContaining('200') },
        ]);
        const rows = (await events()).filter(event => event.pixelId === PIXELS[0]);
        expect(rows.every(event => event.status === 'queued' && event.attempts === 0)).toBe(true);
        // The merchant fixes it in Meta; a test event that works releases the hold.
        graph.refusedPixels.clear();
        await settings({ testEventCode: 'TEST123' });
        expect((await adminClient.query(TEST_EVENT, { pixelId: PIXELS[0] })).sendBdMetaTestEvent.ok).toBe(
            true,
        );
        expect(await holds()).toEqual([]);
        await meta().send();
        expect(
            (await events())
                .filter(event => event.source === 'browser')
                .every(event => event.status === 'sent'),
        ).toBe(true);
    });

    it('retries when Meta is busy or down, with backoff, and gives up after 8 tries', async () => {
        await adminClient.query(TOKEN, { pixelId: PIXELS[0], token: 'busy' });
        await adminClient.query(TOKEN, { pixelId: PIXELS[1], token: 'down' });
        await browserEvent(page('busy00000000000001'));
        await meta().send();
        const rows = await db().query(
            `SELECT "pixelId", status, attempts, error, "nextAttemptAt" > now() + interval '30 seconds' AS later
             FROM bd_meta_event ORDER BY "pixelId"`,
        );
        expect(rows).toEqual([
            {
                pixelId: PIXELS[0],
                status: 'queued',
                attempts: 1,
                error: expect.stringContaining('4:'),
                later: true,
            },
            {
                pixelId: PIXELS[1],
                status: 'queued',
                attempts: 1,
                error: expect.stringContaining('500'),
                later: true,
            },
        ]);
        // Not due yet: the next run doesn't ask Meta again.
        const asked = graph.requests.length;
        await meta().send();
        expect(graph.requests.length).toBe(asked);
        // The eighth failure gives up: failed, and the shopper's IP and browser are dropped.
        await db().query(`UPDATE bd_meta_event SET attempts = 7, "nextAttemptAt" = now()`);
        await meta().send();
        const [last] = await db().query(
            `SELECT status, attempts, "clientIp", "userAgent", "nextAttemptAt" FROM bd_meta_event LIMIT 1`,
        );
        expect(last).toEqual({
            status: 'failed',
            attempts: 8,
            clientIp: null,
            userAgent: null,
            nextAttemptAt: null,
        });
    });

    it('finds the one bad event in a batch by halves and sends the rest', async () => {
        for (let i = 1; i <= 7; i++) await browserEvent(page(`good0000000000000${i}`));
        await browserEvent(page('bad000000000000001'));
        await meta().send();
        const rows = (await events()).filter(event => event.pixelId === PIXELS[0]);
        expect(rows.filter(event => event.status === 'sent')).toHaveLength(7);
        expect(rows.find(event => event.eventId === 'bad000000000000001')!.status).toBe('failed');
        // 8 events: the batch, then halves of 4, 2 and 1 down to the bad one (not 8 single requests).
        expect(requestsTo(PIXELS[0])).toHaveLength(7);
        expect(rows.find(event => event.status === 'sent')!.response).toMatchObject({
            events_received: expect.any(Number),
            batch_size: expect.any(Number),
        });
    });

    it('sends Purchase first, even behind a large backlog of browser events', async () => {
        await settings({ purchaseTrigger: 'placed' });
        // 6,000 browser events waiting (more than one run sends), older than the order.
        await db().query(
            `INSERT INTO bd_meta_event ("createdAt", "updatedAt", "pixelId", "eventName", "eventId", source,
                status, "eventTime", payload, attempts, "nextAttemptAt")
             SELECT now(), now(), $1, 'PageView', 'flood' || n, 'browser', 'queued', now(),
                jsonb_build_object('event_name', 'PageView', 'event_id', 'flood' || n), 0, now()
             FROM generate_series(1, 6000) n`,
            [PIXELS[0]],
        );
        const order = await placedOrder();
        expect(await purchasesOf(order.code)).toHaveLength(2);
        await meta().send();
        const first = requestsTo(PIXELS[0])[0]!.body.data.map(event => event.event_name);
        expect(first[0]).toBe('Purchase');
        expect((await purchasesOf(order.code)).every(event => event.status === 'sent')).toBe(true);
        // One run is bounded: five batches of 1,000 for this Pixel, the rest next minute.
        expect(requestsTo(PIXELS[0])).toHaveLength(5);
        const [{ waiting }] = await db().query(
            `SELECT count(*)::int AS waiting FROM bd_meta_event WHERE status = 'queued' AND "pixelId" = $1`,
            [PIXELS[0]],
        );
        expect(waiting).toBe(1001);
    });

    it('skips the oldest browser events past 20,000 waiting, never a Purchase', async () => {
        // A Pixel without a token: nothing is sent, so the backlog only grows.
        const pixel = '3333333333';
        await db().query(
            `INSERT INTO bd_meta_event ("createdAt", "updatedAt", "pixelId", "eventName", "eventId", source,
                status, "eventTime", payload, attempts, "nextAttemptAt")
             SELECT now(), now(), $1, CASE WHEN n = 1 THEN 'Purchase' ELSE 'PageView' END, 'many' || n,
                CASE WHEN n = 1 THEN 'server' ELSE 'browser' END, 'queued', now(), '{}'::jsonb, 0, now()
             FROM generate_series(1, 20011) n`,
            [pixel],
        );
        await meta().send();
        const rows = await db().query(
            `SELECT status, error, count(*)::int AS n, min("eventId") AS first FROM bd_meta_event
             WHERE "pixelId" = $1 GROUP BY status, error ORDER BY status`,
            [pixel],
        );
        expect(rows).toEqual([
            { status: 'queued', error: null, n: 20001, first: expect.any(String) },
            { status: 'skipped', error: 'backlog', n: 10, first: expect.any(String) },
        ]);
        const [purchase] = await db().query(`SELECT status FROM bd_meta_event WHERE "eventId" = 'many1'`);
        expect(purchase.status).toBe('queued');
    });

    it('never sends an event two overlapping runs could both take', async () => {
        for (let i = 1; i <= 3; i++) await browserEvent(page(`overlap00000000000${i}`));
        await Promise.all([meta().send(), meta().send()]);
        const sentIds = graph.requests
            .filter(request => request.pixelId === PIXELS[0])
            .flatMap(request => request.body.data.map(event => event.event_id));
        expect(sentIds.sort()).toEqual(['overlap000000000001', 'overlap000000000002', 'overlap000000000003']);
    });

    it('skips events Meta no longer takes (older than 7 days)', async () => {
        await browserEvent(page('old000000000000001'));
        await db().query(`UPDATE bd_meta_event SET "eventTime" = now() - interval '8 days'`);
        await meta().send();
        expect((await events()).every(event => event.status === 'skipped' && event.error === 'tooOld')).toBe(
            true,
        );
        expect(graph.requests).toEqual([]);
    });
});

describe('retention', () => {
    it('clears shoppers’ IP and browser on orders after 90 days, placed or not', async () => {
        const placed = await placedOrder();
        // An abandoned checkout: Meta's cookies, IP and browser saved, never placed.
        await shopClient.asAnonymousUser();
        await prepareCheckout(shopClient, { phone: '01715009999', name: 'Karim' });
        await shopClient.query(SET_BROWSER, { input: { fbp: 'fb.1.1729750000000.1', userAgent: UA } });
        const recent = await placedOrder();
        const ip = `"customFieldsMetaclientip"`;
        const ua = `"customFieldsMetauseragent"`;
        const [abandoned] = await db().query(
            `SELECT id FROM "order" WHERE "orderPlacedAt" IS NULL AND ${ua} IS NOT NULL ORDER BY id DESC LIMIT 1`,
        );
        const old = [n(placed.id), abandoned.id];
        await db().query(`UPDATE "order" SET "createdAt" = now() - interval '91 days' WHERE id = ANY($1)`, [
            old,
        ]);
        await meta().retention();
        const rows = await db().query(`SELECT id, ${ip} AS ip, ${ua} AS ua FROM "order" WHERE id = ANY($1)`, [
            [...old, n(recent.id)],
        ]);
        const byId = Object.fromEntries(rows.map((row: { id: number }) => [row.id, row]));
        for (const id of old) expect(byId[id]).toMatchObject({ ip: null, ua: null });
        expect(byId[n(recent.id)]).toMatchObject({ ip: expect.any(String), ua: UA });
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
        // Product IDs as the Shop API shows them (the storefront's own events use these).
        expect(payload.custom_data.content_ids).toEqual([expect.stringMatching(/^T_\d+$/)]);
        expect(payload.action_source).toBe('website');
        await meta().send();
        const sent = graph.requests
            .flatMap(request => request.body.data)
            .find(event => event.event_id === `purchase-${order.code}`)!;
        expect(sent.user_data).toMatchObject({
            client_user_agent: UA,
            client_ip_address: expect.any(String),
        });
    });

    it('with "placed": an online order once it’s paid, never while it waits for payment', async () => {
        const order = await placedOrder();
        await settings({ purchaseTrigger: 'placed' });
        const ctx = await meta().background();
        const entity = await db()
            .getRepository('Order')
            .findOneByOrFail({ id: n(order.id) });
        const bus = server.app.get(EventBus);
        // Placed into AwaitingPayment (the order object itself may already show another state).
        await bus.publish(new OrderPlacedEvent('ArrangingPayment', 'AwaitingPayment', ctx, entity as never));
        await wait(300);
        expect(await purchasesOf(order.code)).toEqual([]);
        // Paid: the gateway's answer moves it on.
        await bus.publish(
            new OrderStateTransitionEvent('AwaitingPayment', 'PaymentSettled', ctx, entity as never),
        );
        await wait(300);
        expect(await purchasesOf(order.code)).toHaveLength(2);
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
        const [purchase] = await purchasesOf(manual.code);
        // A phone order: Meta's action source says so, and there's no page address.
        expect(purchase!.payload.action_source).toBe('phone_call');
        expect(purchase!.payload.event_source_url).toBeUndefined();
    });

    it('event log: by order (code or number), a page at a time', async () => {
        const order = await placedOrder();
        await adminClient.query(CONFIRM, { input: { orderId: order.id } });
        await wait(300);
        for (let i = 1; i <= 3; i++)
            await browserEvent({
                event: 'PageView',
                eventId: `log00000000000000${i}`,
                url: 'https://shop.example.com/',
            });
        expect(await events({ order: order.code })).toHaveLength(2);
        const [{ number }] = await db().query(
            `SELECT "customFieldsOrdernumber" AS number FROM "order" WHERE id = $1`,
            [n(order.id)],
        );
        if (number) expect(await events({ order: number })).toHaveLength(2);
        expect(await events({ order: 'NO-SUCH-ORDER' })).toEqual([]);
        const firstPage = await events({ take: 3 });
        const secondPage = await events({ take: 3, skip: 3 });
        expect(firstPage).toHaveLength(3);
        expect(secondPage).toHaveLength(3);
        expect(new Set([...firstPage, ...secondPage].map(event => event.id)).size).toBe(6);
    });
});

describe('rate limits', () => {
    // Last in the file: it uses up this address's allowance for a minute.
    it('takes at most 120 browser events a minute from one address', async () => {
        const ids = Array.from({ length: 130 }, (_, i) => `limit${String(i).padStart(14, '0')}`);
        for (const eventId of ids)
            await browserEvent({ event: 'PageView', eventId, url: 'https://shop.example.com/' });
        const queued = new Set(
            (await db().query(`SELECT "eventId" FROM bd_meta_event`)).map(
                (row: { eventId: string }) => row.eventId,
            ),
        );
        expect(queued.size).toBeLessThanOrEqual(120);
        expect(queued.has(ids[129]!)).toBe(false);
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

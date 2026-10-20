import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createHttpClient,
    HttpError,
    type HttpClientOptions,
    type HttpEvent,
    parseRetryAfter,
    redactUrl,
    toHttpError,
} from './http';
import { SsrfBlockedError } from './ssrf';

let server: Server;
let port: number;
let base: string;
const hits = new Map<string, number>();

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise(resolve => {
        let body = '';
        request.on('data', (chunk: Buffer) => (body += chunk.toString()));
        request.on('end', () => resolve(body));
    });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://test');
    const count = (hits.get(request.url ?? '') ?? 0) + 1;
    hits.set(request.url ?? '', count);
    const json = (status: number, value: unknown) =>
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    switch (url.pathname) {
        case '/ok':
            return void json(200, { ok: true });
        case '/echo':
            return void json(200, {
                method: request.method,
                headers: request.headers,
                body: await readBody(request),
            });
        case '/flaky':
            return void response
                .writeHead(count <= Number(url.searchParams.get('fail')) ? 503 : 200)
                .end('flaky');
        case '/retry-after':
            if (count === 1) {
                return void response
                    .writeHead(429, { 'retry-after': url.searchParams.get('value') ?? '1' })
                    .end();
            }
            return void response.writeHead(200).end('ok');
        case '/status':
            return void response.writeHead(Number(url.searchParams.get('code'))).end();
        case '/slow':
            return void setTimeout(() => response.end('late'), 300);
        case '/big':
            return void response.writeHead(200, { 'content-length': '2000' }).end('x'.repeat(2000));
        case '/big-stream':
            response.writeHead(200);
            response.write('x'.repeat(800));
            response.write('x'.repeat(800));
            return void response.end('x'.repeat(800));
        case '/redirect':
            return void response.writeHead(302, { location: url.searchParams.get('to') ?? '/ok' }).end();
        case '/redirect-303':
            return void response.writeHead(303, { location: '/echo' }).end();
        case '/redirect-307':
            return void response.writeHead(307, { location: '/echo' }).end();
        case '/no-location':
            return void response.writeHead(302).end('no location');
        case '/loop':
            return void response.writeHead(302, { location: '/loop' }).end();
        default:
            return void response.writeHead(404).end();
    }
}

beforeAll(async () => {
    server = createServer((request, response) => void handle(request, response));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

function client(overrides: HttpClientOptions = {}) {
    const delays: number[] = [];
    const http = createHttpClient({
        ssrfProtection: false,
        sleep: async ms => {
            delays.push(ms);
        },
        random: () => 0.5,
        ...overrides,
    });
    return { http, delays };
}

describe('requests', () => {
    it('returns status, body and final URL, sends request ID and user agent, and reports a redacted event', async () => {
        const events: HttpEvent[] = [];
        const { http } = client({ onEvent: event => events.push(event) });
        const response = await http.request(`${base}/echo?token=abc&page=2`, {
            requestId: 'req-1234567890',
            headers: { 'X-Custom': '1' },
        });
        const body = response.json<{ headers: Record<string, string> }>();
        expect(response.status).toBe(200);
        expect(response.url).toBe(`${base}/echo?token=abc&page=2`);
        expect(response.text()).toContain('x-request-id');
        expect(body.headers['x-request-id']).toBe('req-1234567890');
        expect(body.headers['user-agent']).toBe('EcommBD');
        expect(body.headers['x-custom']).toBe('1');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: 'response',
            method: 'GET',
            status: 200,
            attempt: 0,
            requestId: 'req-1234567890',
        });
        expect(events[0]?.url).not.toContain('abc');
        expect(events[0]?.url).toContain('page=2');
        await http.close();
    });

    it('returns a HEAD response with an empty body', async () => {
        const { http } = client();
        const response = await http.request(`${base}/ok`, { method: 'head' });
        expect(response.body).toHaveLength(0);
    });

    it('passes other client errors straight back', async () => {
        const { http } = client();
        expect((await http.request(`${base}/status?code=404`)).status).toBe(404);
    });
});

describe('retries', () => {
    it('retries idempotent requests on 503 with exponential backoff and jitter', async () => {
        const events: HttpEvent[] = [];
        const { http, delays } = client({ onEvent: event => events.push(event) });
        const response = await http.request(`${base}/flaky?fail=2&k=a`);
        expect(response.status).toBe(200);
        expect(delays).toEqual([100, 200]);
        expect(events.map(event => event.type)).toEqual(['retry', 'retry', 'response']);
    });

    it('does not retry POST unless the caller says it is idempotent', async () => {
        const { http, delays } = client();
        expect((await http.request(`${base}/flaky?fail=1&k=b`, { method: 'POST' })).status).toBe(503);
        expect(delays).toEqual([]);
        const retried = await http.request(`${base}/flaky?fail=1&k=c`, { method: 'POST', idempotent: true });
        expect(retried.status).toBe(200);
        expect(delays).toHaveLength(1);
    });

    it('honours Retry-After and caps it', async () => {
        const { http, delays } = client();
        await http.request(`${base}/retry-after?value=1`);
        await http.request(`${base}/retry-after?value=60`);
        expect(delays).toEqual([1000, 5000]);
    });

    it('returns the last response when retries run out', async () => {
        const { http, delays } = client({ maxRetries: 1 });
        expect((await http.request(`${base}/flaky?fail=10&k=d`)).status).toBe(503);
        expect(delays).toHaveLength(1);
    });

    it('uses real timers by default', async () => {
        const http = createHttpClient({ ssrfProtection: false, retryBaseDelayMs: 1 });
        expect((await http.request(`${base}/flaky?fail=1&k=e`)).status).toBe(200);
    });
});

describe('failures', () => {
    it('times out slow responses, retrying only idempotent requests', async () => {
        const { http, delays } = client({ timeoutMs: 50, maxRetries: 1 });
        await expect(http.request(`${base}/slow?k=1`)).rejects.toMatchObject({ kind: 'timeout' });
        expect(delays).toHaveLength(1);
        const { http: post, delays: postDelays } = client();
        await expect(
            post.request(`${base}/slow?k=2`, { method: 'POST', timeoutMs: 50 }),
        ).rejects.toMatchObject({
            kind: 'timeout',
        });
        expect(postDelays).toEqual([]);
    });

    it('reports network failures', async () => {
        const closed = createServer();
        await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
        const closedPort = (closed.address() as AddressInfo).port;
        await new Promise(resolve => closed.close(resolve));
        const { http } = client({ maxRetries: 0 });
        await expect(http.request(`http://127.0.0.1:${closedPort}/`)).rejects.toMatchObject({
            kind: 'network',
        });
    });

    it('caps the response size, whether declared or streamed', async () => {
        const { http } = client({ maxResponseBytes: 1000 });
        await expect(http.request(`${base}/big`)).rejects.toMatchObject({ kind: 'too_large' });
        await expect(http.request(`${base}/big`, { method: 'HEAD' })).rejects.toMatchObject({
            kind: 'too_large',
        });
        await expect(http.request(`${base}/big-stream`)).rejects.toMatchObject({ kind: 'too_large' });
    });
});

describe('redirects', () => {
    it('follows redirects, including for HEAD', async () => {
        const { http } = client();
        const response = await http.request(`${base}/redirect`);
        expect(response.status).toBe(200);
        expect(response.url).toBe(`${base}/ok`);
        expect((await http.request(`${base}/redirect`, { method: 'HEAD' })).status).toBe(200);
    });

    it('stops redirect loops', async () => {
        const { http } = client();
        await expect(http.request(`${base}/loop`)).rejects.toMatchObject({ kind: 'too_many_redirects' });
    });

    it('returns a redirect without a Location header as is', async () => {
        const { http } = client();
        expect((await http.request(`${base}/no-location`)).status).toBe(302);
    });

    it('turns POST into GET on 303 and 302, and keeps it on 307', async () => {
        const { http } = client();
        const post = { method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' } };
        const after303 = (await http.request(`${base}/redirect-303`, post)).json<{
            method: string;
            body: string;
            headers: Record<string, string>;
        }>();
        expect(after303).toMatchObject({ method: 'GET', body: '' });
        expect(after303.headers['content-type']).toBeUndefined();
        expect(
            (await http.request(`${base}/redirect?to=/echo`, post)).json<{ method: string }>().method,
        ).toBe('GET');
        expect(
            (await http.request(`${base}/redirect-307`, post)).json<{ method: string; body: string }>(),
        ).toMatchObject({
            method: 'POST',
            body: 'payload',
        });
    });

    it('drops credentials on cross-origin redirects only', async () => {
        const { http } = client();
        const headers = { authorization: 'Bearer secret', cookie: 'session=1' };
        const cross = await http.request(`${base}/redirect?to=http://localhost:${port}/echo`, { headers });
        expect(cross.json<{ headers: Record<string, string> }>().headers.authorization).toBeUndefined();
        expect(cross.json<{ headers: Record<string, string> }>().headers.cookie).toBeUndefined();
        const same = await http.request(`${base}/redirect?to=/echo`, { headers });
        expect(same.json<{ headers: Record<string, string> }>().headers.authorization).toBe('Bearer secret');
    });
});

describe('circuit breaker', () => {
    it('pauses calls to a host after repeated server errors', async () => {
        const { http } = client({
            maxRetries: 0,
            circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
        });
        expect((await http.request(`${base}/status?code=500`)).status).toBe(500);
        expect((await http.request(`${base}/status?code=500`)).status).toBe(500);
        await expect(http.request(`${base}/ok`)).rejects.toMatchObject({ kind: 'circuit_open' });
    });

    it('resets after a success, and can be turned off', async () => {
        const { http } = client({ maxRetries: 0, circuitBreaker: { failureThreshold: 2 } });
        await http.request(`${base}/status?code=500`);
        await http.request(`${base}/ok`);
        await http.request(`${base}/status?code=500`);
        expect((await http.request(`${base}/ok`)).status).toBe(200);

        const { http: unguarded } = client({ maxRetries: 0, circuitBreaker: false });
        for (let i = 0; i < 6; i += 1) {
            expect((await unguarded.request(`${base}/status?code=500`)).status).toBe(500);
        }
    });
});

describe('SSRF protection', () => {
    it('blocks private IP literals and hostnames that resolve to private addresses', async () => {
        const http = createHttpClient({
            maxRetries: 0,
            urlPolicy: { allowedPorts: [port] },
            resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        });
        await expect(http.request(`http://127.0.0.1:${port}/ok`)).rejects.toMatchObject({ kind: 'blocked' });
        await expect(http.request(`http://internal.example:${port}/ok`)).rejects.toMatchObject({
            kind: 'blocked',
        });
    });
});

describe('helpers', () => {
    it('parses Retry-After', () => {
        const now = Date.parse('2026-10-20T00:00:00Z');
        expect(parseRetryAfter(null)).toBeUndefined();
        expect(parseRetryAfter(' 3 ')).toBe(3000);
        expect(parseRetryAfter('Tue, 20 Oct 2026 00:00:02 GMT', now)).toBe(2000);
        expect(parseRetryAfter('Mon, 19 Oct 2026 00:00:00 GMT', now)).toBe(0);
        expect(parseRetryAfter('soon')).toBeUndefined();
    });

    it('redacts sensitive query values', () => {
        expect(redactUrl('https://x.com/a?token=abc&page=2')).toBe(
            'https://x.com/a?token=%5BREDACTED%5D&page=2',
        );
    });

    it('maps thrown values to error kinds', () => {
        const existing = new HttpError('too_large', 'big');
        expect(toHttpError(existing)).toBe(existing);
        expect(toHttpError(Object.assign(new Error('x'), { name: 'AbortError' })).kind).toBe('timeout');
        expect(
            toHttpError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })).kind,
        ).toBe('timeout');
        expect(toHttpError(new TypeError('fetch failed', { cause: new SsrfBlockedError('no') })).kind).toBe(
            'blocked',
        );
        expect(toHttpError('weird').kind).toBe('network');
        let deep: Error = new SsrfBlockedError('deep');
        for (let i = 0; i < 6; i += 1) {
            deep = new Error('wrap', { cause: deep });
        }
        expect(toHttpError(deep).kind).toBe('network');
    });
});

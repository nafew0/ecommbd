// The storefront's Node server (roadmap phase 12): `npm run start -w @ecommbd/storefront` after
// `npm run build`. Astro renders the pages (built in middleware mode); this file adds what a
// production process needs around it:
// - `/health` for the deploy agent and load checks (reports whether the core answers),
// - the built static files (`/_astro/…` cached for a year as immutable),
// - with `PROXY_CORE` (on unless APP_ENV is staging or production), the core's paths passed through to
//   it: `/img`, `/assets` and `/shop-api` for the pages, plus the merchant admin, the Dashboard, their
//   APIs, `/bd-geo` and the payment gateways' `/bd-pay`, so a whole store answers on this one port.
//   Development uses it, and so do the CloudPanel stores (docs/runbooks/cloudpanel-stores.md) until
//   Nginx routes them (roadmap 24),
// - one JSON log line per request (no query strings, no tracking tokens),
// - graceful shutdown: on SIGTERM it stops accepting connections and finishes open requests.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './dist/server/entry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, 'dist/client');
const port = Number(process.env.PORT ?? 4321);
const host = process.env.HOST ?? '0.0.0.0';
const coreUrl = new URL(process.env.CORE_URL ?? 'http://localhost:3000');
const live = ['staging', 'production'].includes(process.env.APP_ENV ?? '');
const proxyCore = (process.env.PROXY_CORE ?? (live ? 'false' : 'true')) === 'true';
// /bd-pay: payment gateways send shoppers back and notify the core there (phase 18); /bd-courier:
// courier status webhooks (phase 19).
const CORE_PATHS = ['/img', '/assets', '/shop-api', '/admin', '/admin-api', '/dashboard', '/bd-geo', '/bd-pay', '/bd-courier'];
const isCorePath = pathname =>
    CORE_PATHS.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

function log(entry) {
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
}

/** A built file from dist/client, or false. Never outside that folder. */
function serveStatic(req, res, pathname) {
    const file = path.normalize(path.join(clientDir, decodeURIComponent(pathname)));
    if (!file.startsWith(clientDir + path.sep)) return false;
    let stat;
    try {
        stat = fs.statSync(file);
    } catch {
        return false;
    }
    if (!stat.isFile()) return false;
    res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'content-length': stat.size,
        'x-content-type-options': 'nosniff',
        'cache-control': pathname.startsWith('/_astro/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
}

function proxy(req, res) {
    const upstream = http.request(
        {
            hostname: coreUrl.hostname,
            port: coreUrl.port || 80,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: coreUrl.host },
        },
        response => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
        },
    );
    upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('The core is not reachable');
    });
    req.pipe(upstream);
}

async function health(res) {
    const core = await fetch(new URL('/health', coreUrl), { signal: AbortSignal.timeout(2000) }).then(
        response => (response.ok ? 'ok' : 'down'),
        () => 'down',
    );
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok', core }));
}

/**
 * The path for the log: no query string, and keys masked: tracking tokens (`/t/<token>/`), payment
 * attempt keys and tracking tokens under `/bd-pay/` (phase 18), courier webhook secrets (phase 19).
 */
function logPath(url) {
    const pathname = url.split('?')[0];
    return pathname
        .replace(/^((?:\/(?:en|bn))?\/t\/)[^/]+/, '$1…')
        .replace(/^(\/bd-pay\/(?:start|again|sslcommerz\/return|bkash\/callback)\/)[^/]+/, '$1…')
        .replace(/^(\/bd-courier\/webhook\/[a-z]+\/)[^/]+/, '$1…');
}

const server = http.createServer((req, res) => {
    const started = process.hrtime.bigint();
    const pathname = (req.url ?? '/').split('?')[0];
    res.on('finish', () => {
        log({
            level: res.statusCode >= 500 ? 'error' : 'info',
            msg: 'request',
            method: req.method,
            path: logPath(req.url ?? '/'),
            status: res.statusCode,
            ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        });
    });
    if (pathname === '/health') return void health(res);
    if (proxyCore && isCorePath(pathname)) return proxy(req, res);
    if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        pathname !== '/' &&
        serveStatic(req, res, pathname)
    )
        return;
    handler(req, res);
});

server.keepAliveTimeout = 65_000;
server.listen(port, host, () =>
    log({ level: 'info', msg: `storefront listening on http://${host}:${port}` }),
);

let closing = false;
function shutdown(signal) {
    if (closing) return;
    closing = true;
    log({ level: 'info', msg: `${signal}: finishing open requests` });
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // Requests still running after 10 seconds are cut off.
    setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

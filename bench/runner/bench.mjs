#!/usr/bin/env node
// Scripted checkout benchmark: Vendure vs Medusa on the same Postgres + Redis.
//
// Usage: node runner/bench.mjs <vendure|medusa> [runLabel]
//
// For each engine: start the production server, time boot until /health answers,
// measure idle memory, warm up, then run the same guest checkout
//   product → add to cart → customer + address → shipping options → set shipping → payment → place order
// sequentially (1 shopper) and concurrently (10 shoppers). Memory is the RSS of the
// server's whole process tree, sampled every 250 ms.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'results');

// Overridable for quick smoke tests, e.g. BENCH_SEQUENTIAL=5 BENCH_CONCURRENT=10.
const WARMUP = +(process.env.BENCH_WARMUP ?? 30);
const SEQUENTIAL = +(process.env.BENCH_SEQUENTIAL ?? 200);
const CONCURRENCY = +(process.env.BENCH_CONCURRENCY ?? 10);
const CONCURRENT_TOTAL = +(process.env.BENCH_CONCURRENT ?? 500);
const IDLE_WAIT_MS = +(process.env.BENCH_IDLE_WAIT_MS ?? 15_000);
const AFTER_WAIT_MS = +(process.env.BENCH_AFTER_WAIT_MS ?? 10_000);

const STEPS = ['product', 'addToCart', 'customerAddress', 'shippingOptions', 'setShipping', 'payment', 'placeOrder'];

// ---------- helpers ----------

function readEnvFile(file) {
    const env = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) env[m[1]] = m[2];
    }
    return env;
}

function treeRssMb(rootPid) {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=']).toString();
    const rss = new Map();
    const children = new Map();
    for (const line of out.trim().split('\n')) {
        const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
        rss.set(pid, kb);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
    }
    let kb = 0;
    let procs = 0;
    const stack = [rootPid];
    while (stack.length) {
        const pid = stack.pop();
        if (!rss.has(pid)) continue;
        kb += rss.get(pid);
        procs++;
        stack.push(...(children.get(pid) ?? []));
    }
    return { mb: kb / 1024, procs };
}

function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

function summarize(values) {
    const s = [...values].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return { n: s.length, mean, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.at(-1) };
}

async function step(rec, name, fn) {
    const t = performance.now();
    const result = await fn();
    rec[name] = (rec[name] ?? 0) + (performance.now() - t);
    return result;
}

// ---------- Vendure (GraphQL Shop API) ----------

const V = {
    product: `query ($slug: String!) { product(slug: $slug) { id name slug variants { id name priceWithTax stockLevel } } }`,
    add: `mutation ($id: ID!) { addItemToOrder(productVariantId: $id, quantity: 1) { ... on Order { id code totalWithTax } ... on ErrorResult { errorCode message } } }`,
    customer: `mutation ($input: CreateCustomerInput!) { setCustomerForOrder(input: $input) { ... on Order { id } ... on ErrorResult { errorCode message } } }`,
    address: `mutation ($input: CreateAddressInput!) { setOrderShippingAddress(input: $input) { ... on Order { id } ... on ErrorResult { errorCode message } } }`,
    eligible: `query { eligibleShippingMethods { id name priceWithTax } }`,
    setShipping: `mutation ($id: [ID!]!) { setOrderShippingMethod(shippingMethodId: $id) { ... on Order { id totalWithTax } ... on ErrorResult { errorCode message } } }`,
    transition: `mutation { transitionOrderToState(state: "ArrangingPayment") { ... on Order { id state } ... on ErrorResult { errorCode message } } }`,
    pay: `mutation ($input: PaymentInput!) { addPaymentToOrder(input: $input) { ... on Order { id code state totalWithTax } ... on ErrorResult { errorCode message } } }`,
};

function vendureClient(base, apiPath) {
    return async function gql(ctx, query, variables) {
        const headers = { 'content-type': 'application/json' };
        if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
        const res = await fetch(`${base}/${apiPath}`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
        const token = res.headers.get('vendure-auth-token');
        if (token) ctx.token = token;
        const body = await res.json();
        if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
        return body.data;
    };
}

function vendureOk(result, label) {
    if (!result || result.errorCode) throw new Error(`${label}: ${JSON.stringify(result)}`);
    return result;
}

const vendure = {
    cwd: path.join(ROOT, 'vendure'),
    command: ['node', ['dist/index.js']],
    env: () => ({ NODE_ENV: 'production' }),
    base: 'http://127.0.0.1:3000',
    health: '/health',

    async setup() {
        const admin = vendureClient(this.base, 'admin-api');
        const ctx = {};
        await admin(ctx, `mutation { login(username: "bench-admin", password: "bench-admin-local-only-7f3k") { ... on CurrentUser { id } } }`);
        const { product } = await admin(ctx, `query { product(slug: "laptop") { variants { id stockLevels { stockLocationId stockOnHand } } } }`);
        const variant = product.variants[0];
        // Plenty of stock so 700+ orders never run out (Medusa's seed uses 1,000,000 too).
        await admin(ctx, `mutation ($input: [UpdateProductVariantInput!]!) { updateProductVariants(input: $input) { id } }`, {
            input: [{ id: variant.id, stockLevels: variant.stockLevels.map(l => ({ stockLocationId: l.stockLocationId, stockOnHand: 1_000_000 })) }],
        });
        const { paymentMethods } = await admin(ctx, `query { paymentMethods { items { code enabled } } }`);
        const method = paymentMethods.items.find(m => m.enabled);
        if (!method) throw new Error('No enabled payment method');
        return { paymentCode: method.code };
    },

    async checkout(i, rec, state) {
        const gql = vendureClient(this.base, 'shop-api');
        const ctx = {};
        const { product } = await step(rec, 'product', () => gql(ctx, V.product, { slug: 'laptop' }));
        const variantId = product.variants[0].id;
        await step(rec, 'addToCart', async () => vendureOk((await gql(ctx, V.add, { id: variantId })).addItemToOrder, 'addItemToOrder'));
        await step(rec, 'customerAddress', async () => {
            vendureOk((await gql(ctx, V.customer, { input: { emailAddress: `bench-${process.pid}-${i}@example.com`, firstName: 'Bench', lastName: 'Shopper' } })).setCustomerForOrder, 'setCustomerForOrder');
            vendureOk((await gql(ctx, V.address, { input: { fullName: 'Bench Shopper', streetLine1: '1 Test Road', city: 'London', postalCode: 'SW1A 1AA', countryCode: 'GB', phoneNumber: '01700000000' } })).setOrderShippingAddress, 'setOrderShippingAddress');
        });
        const { eligibleShippingMethods } = await step(rec, 'shippingOptions', () => gql(ctx, V.eligible));
        await step(rec, 'setShipping', async () => vendureOk((await gql(ctx, V.setShipping, { id: [eligibleShippingMethods[0].id] })).setOrderShippingMethod, 'setOrderShippingMethod'));
        await step(rec, 'payment', async () => vendureOk((await gql(ctx, V.transition)).transitionOrderToState, 'transitionOrderToState'));
        const order = await step(rec, 'placeOrder', async () => vendureOk((await gql(ctx, V.pay, { input: { method: state.paymentCode, metadata: {} } })).addPaymentToOrder, 'addPaymentToOrder'));
        if (order.state !== 'PaymentAuthorized') throw new Error(`Unexpected order state ${order.state}`);
    },
};

// ---------- Medusa (REST Store API) ----------

const medusaEnv = () => readEnvFile(path.join(ROOT, 'medusa/.env'));

const medusa = {
    cwd: path.join(ROOT, 'medusa/.medusa/server'),
    command: ['node', ['node_modules/@medusajs/cli/cli.js', 'start']],
    env: () => ({ ...medusaEnv(), NODE_ENV: 'production', PORT: '9000' }),
    base: 'http://127.0.0.1:9000',
    health: '/health',

    async setup() {
        const pk = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'bench', '-d', 'medusa', '-tA', '-c',
            "select token from api_key where type = 'publishable' and revoked_at is null limit 1"], { cwd: ROOT }).toString().trim();
        const headers = { 'x-publishable-api-key': pk };
        const { regions } = await (await fetch(`${this.base}/store/regions`, { headers })).json();
        return { pk, regionId: regions[0].id };
    },

    async checkout(i, rec, state) {
        const headers = { 'content-type': 'application/json', 'x-publishable-api-key': state.pk };
        const call = async (method, url, body) => {
            const res = await fetch(`${this.base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
            const text = await res.text();
            if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
            return JSON.parse(text);
        };
        const address = { first_name: 'Bench', last_name: 'Shopper', address_1: '1 Test Road', city: 'London', postal_code: 'SW1A 1AA', country_code: 'gb', phone: '01700000000' };
        const { products } = await step(rec, 'product', () =>
            call('GET', `/store/products?handle=t-shirt&region_id=${state.regionId}&fields=id,title,handle,*variants,*variants.calculated_price,+variants.inventory_quantity`));
        const variantId = products[0].variants[0].id;
        const { cart } = await step(rec, 'addToCart', () =>
            call('POST', '/store/carts?fields=id,total', { region_id: state.regionId, items: [{ variant_id: variantId, quantity: 1 }] }));
        await step(rec, 'customerAddress', () =>
            call('POST', `/store/carts/${cart.id}?fields=id,total`, { email: `bench-${process.pid}-${i}@example.com`, shipping_address: address, billing_address: address }));
        const { shipping_options } = await step(rec, 'shippingOptions', () => call('GET', `/store/shipping-options?cart_id=${cart.id}`));
        await step(rec, 'setShipping', () =>
            call('POST', `/store/carts/${cart.id}/shipping-methods?fields=id,total`, { option_id: shipping_options[0].id }));
        await step(rec, 'payment', async () => {
            const { payment_collection } = await call('POST', '/store/payment-collections', { cart_id: cart.id });
            await call('POST', `/store/payment-collections/${payment_collection.id}/payment-sessions`, { provider_id: 'pp_system_default' });
        });
        const done = await step(rec, 'placeOrder', () => call('POST', `/store/carts/${cart.id}/complete`));
        if (done.type !== 'order') throw new Error(`Cart not completed: ${JSON.stringify(done).slice(0, 300)}`);
    },
};

// ---------- runner ----------

async function runCheckouts(engine, state, total, concurrency, onError) {
    const records = [];
    let next = 0;
    let errors = 0;
    const started = performance.now();
    async function worker() {
        while (next < total) {
            const i = next++;
            const rec = {};
            const t = performance.now();
            try {
                await engine.checkout(i, rec, state);
                rec.total = performance.now() - t;
                records.push(rec);
            } catch (err) {
                errors++;
                onError(err);
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    const seconds = (performance.now() - started) / 1000;
    const stats = {};
    for (const name of [...STEPS, 'total']) stats[name] = summarize(records.map(r => r[name]));
    return { completed: records.length, errors, seconds, checkoutsPerSecond: records.length / seconds, stats };
}

async function main() {
    const name = process.argv[2];
    const label = process.argv[3] ?? 'run1';
    const engine = { vendure, medusa }[name];
    if (!engine) throw new Error('Usage: node runner/bench.mjs <vendure|medusa> [label]');

    const [cmd, args] = engine.command;
    const logFile = path.join(RESULTS_DIR, `${name}-${label}.server.log`);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const log = fs.openSync(logFile, 'w');
    const bootStart = performance.now();
    const server = spawn(cmd, args, { cwd: engine.cwd, env: { ...process.env, ...engine.env() }, stdio: ['ignore', log, log] });
    let exited = false;
    server.on('exit', code => { exited = true; if (code) console.error(`server exited with code ${code}, see ${logFile}`); });

    const stop = async () => {
        if (exited) return;
        server.kill('SIGTERM');
        for (let i = 0; i < 100 && !exited; i++) await sleep(100);
        if (!exited) server.kill('SIGKILL');
    };

    try {
        let bootMs = null;
        for (let i = 0; i < 1200 && !exited; i++) {
            try {
                const res = await fetch(`${engine.base}${engine.health}`);
                if (res.ok) { bootMs = performance.now() - bootStart; break; }
            } catch { /* not up yet */ }
            await sleep(100);
        }
        if (bootMs === null) throw new Error(`Server did not become healthy, see ${logFile}`);
        console.log(`[${name}] healthy after ${(bootMs / 1000).toFixed(1)} s`);

        const state = await engine.setup();
        await sleep(IDLE_WAIT_MS);
        const idle = treeRssMb(server.pid);
        console.log(`[${name}] idle RSS ${idle.mb.toFixed(0)} MB across ${idle.procs} process(es)`);

        let firstError = null;
        const onError = err => { if (!firstError) { firstError = err; console.error(`[${name}] checkout error: ${err.message}`); } };

        await runCheckouts(engine, state, WARMUP, 1, onError);
        if (firstError) throw firstError;
        console.log(`[${name}] warm-up done (${WARMUP} checkouts)`);

        let peak = treeRssMb(server.pid).mb;
        const sampler = setInterval(() => { try { peak = Math.max(peak, treeRssMb(server.pid).mb); } catch { /* process gone */ } }, 250);

        const sequential = await runCheckouts(engine, state, SEQUENTIAL, 1, onError);
        console.log(`[${name}] 1 shopper: ${sequential.completed} checkouts, p50 ${sequential.stats.total.p50.toFixed(0)} ms, p95 ${sequential.stats.total.p95.toFixed(0)} ms`);

        const concurrent = await runCheckouts(engine, state, CONCURRENT_TOTAL, CONCURRENCY, onError);
        console.log(`[${name}] ${CONCURRENCY} shoppers: ${concurrent.completed} checkouts, p50 ${concurrent.stats.total.p50.toFixed(0)} ms, p95 ${concurrent.stats.total.p95.toFixed(0)} ms, ${concurrent.checkoutsPerSecond.toFixed(1)} checkouts/s`);

        clearInterval(sampler);
        await sleep(AFTER_WAIT_MS);
        const after = treeRssMb(server.pid);

        const result = {
            engine: name,
            label,
            node: process.version,
            date: new Date().toISOString(),
            bootSeconds: bootMs / 1000,
            memoryMb: { idle: idle.mb, peak, afterLoad: after.mb, processes: idle.procs },
            sequential,
            concurrent: { concurrency: CONCURRENCY, ...concurrent },
        };
        fs.writeFileSync(path.join(RESULTS_DIR, `${name}-${label}.json`), JSON.stringify(result, null, 2));
        console.log(`[${name}] memory idle ${idle.mb.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, after load ${after.mb.toFixed(0)} MB`);
        console.log(`[${name}] results → results/${name}-${label}.json`);
    } finally {
        await stop();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

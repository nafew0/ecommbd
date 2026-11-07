/**
 * The storefront speed suite (roadmap phase 17): `npm run test:speed`, after `npm run build`.
 *
 * Starts a throwaway copy of the whole stack on free ports: its own database, the built core and
 * worker, the built storefront, and the real Varnish image (infra/varnish) in front of it. Then:
 *
 * 1. the cache tests (tests/speed), and with SPEED_ALL_BROWSERS=1 the whole browser suite through
 *    Varnish;
 * 2. the JavaScript budgets (size-limit) and Lighthouse on a product and a sales page, then a
 *    deliberately oversized file and an impossible LCP budget, which must both fail;
 * 3. a core and worker restart, which must purge nothing;
 * 4. a Varnish restart, after which the worker must warm the store's top pages into the very
 *    entries shoppers use;
 * 5. outage grace (storefront stopped: the cached page is still served) and a hard purge (then
 *    Varnish's own bilingual "unavailable" page).
 *
 * Everything it started is removed at the end. PostgreSQL and Redis must be running
 * (`npm run services:up`). SPEED_CORE_DIR runs another build of the core (default apps/core/dist).
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

if (['staging', 'production'].includes(process.env.APP_ENV))
    throw new Error('Speed tests require a disposable development environment');
const id = String(Date.now()),
    name = `ecommbd-speed-${id}`,
    database = `ecommbd_speed_${id}`;
const coreDir = process.env.SPEED_CORE_DIR ?? 'apps/core/dist';
const freePort = () =>
    new Promise(resolve => {
        const s = createServer();
        s.listen(0, '0.0.0.0', () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
const [corePort, sitePort, cachePort, purgePort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
]);
// Shoppers' address: Varnish. The core's STOREFRONT_URL is the same, so its warm-up requests carry
// the shoppers' Host and fill the entries they use.
const site = `http://localhost:${cachePort}`,
    // A real secret every run: Varnish refuses an empty or all-zero one.
    secret = randomBytes(32).toString('hex');
const env = {
    ...process.env,
    APP_ENV: 'dev',
    COOKIE_SECRET: 'speed-fixture-only-cookie-secret-0123456789',
    SUPERADMIN_USERNAME: 'superadmin',
    SUPERADMIN_PASSWORD: 'superadmin',
    DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.DB_PORT ?? '54320',
    DB_USERNAME: process.env.DB_USERNAME ?? 'ecommbd',
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'ecommbd',
    DB_NAME: database,
    REDIS_QUEUE_HOST: process.env.REDIS_QUEUE_HOST ?? '127.0.0.1',
    REDIS_QUEUE_PORT: process.env.REDIS_QUEUE_PORT ?? '63790',
    REDIS_CACHE_HOST: process.env.REDIS_CACHE_HOST ?? '127.0.0.1',
    REDIS_CACHE_PORT: process.env.REDIS_CACHE_PORT ?? '63791',
    REDIS_KEY_PREFIX: name,
    CACHE_STORE_ID: 'store17',
    CACHE_PURGE_URL: `http://127.0.0.1:${purgePort}/`,
    CACHE_PURGE_SECRET: secret,
    CACHE_WARM_UP: 'true',
    // Listing follow-ups after 2 seconds instead of 10, so the tests don't wait long.
    CACHE_LISTING_SETTLE_MS: '2000',
    STOREFRONT_URL: site,
    SITE_URL: site,
    CORE_URL: `http://localhost:${corePort}`,
    EDITOR_ORIGIN: `http://localhost:${corePort}`,
    BROWSER_BASE_URL: `http://localhost:${corePort}`,
    VENDURE_SERVER_PORT: String(corePort),
    PORT: String(corePort),
    // Every visit is sampled, so the beacon test can see one.
    VITALS_SAMPLE_RATE: '1',
    CACHE_TTL_SECONDS: '60',
    TRACKING_RATE_LIMIT_PER_IP: '1000',
    WOO_PUBLIC_URL: 'https://destination.fixture.test',
    WOO_IMPORT_KEYS: 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};
const db = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: 'postgres',
});
const children = [];
fs.mkdirSync('.performance', { recursive: true });
// One log per process for this run (a restarted process appends to its own).
for (const label of ['core', 'worker', 'storefront']) fs.writeFileSync(`.performance/${label}.log`, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args = [], extra = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(command, args, { stdio: 'inherit', env, ...extra });
        p.on('error', reject);
        p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    });
}
function start(label, command, args, vars = {}) {
    const output = fs.openSync(`.performance/${label}.log`, 'a');
    const p = spawn(command, args, { env: { ...env, ...vars }, stdio: ['ignore', output, output] });
    children.push(p);
    return p;
}
async function ready(url) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
        if (
            await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
                r => r.ok,
                () => false,
            )
        )
            return;
        await sleep(300);
    }
    throw new Error('Service not ready: ' + url);
}
async function stop(p) {
    if (p.exitCode !== null) return;
    p.kill('SIGTERM');
    await Promise.race([once(p, 'exit'), sleep(11000)]);
    if (p.exitCode === null) p.kill('SIGKILL');
}
const startCore = () => start('core', 'node', [path.join(coreDir, 'index.js')]);
const startWorker = () => start('worker', 'node', [path.join(coreDir, 'index-worker.js')]);

/** The cached object a response came from (`x-varnish`'s second number on a HIT). */
const objectOf = response => {
    const ids = (response.headers.get('x-varnish') ?? '').split(' ');
    return ids[1] ?? ids[0];
};

/** The Admin API as the superadmin (bearer token). */
async function adminApi() {
    let token;
    const query = async (q, variables) => {
        const response = await fetch(`${env.CORE_URL}/admin-api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ query: q, variables }),
        });
        token = response.headers.get('vendure-auth-token') ?? token;
        const json = await response.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);
        return json.data;
    };
    await query('mutation { login(username: "superadmin", password: "superadmin") { __typename } }');
    return query;
}

const results = {};
try {
    await db.connect();
    await db.query(`CREATE DATABASE "${database}"`);
    await run('docker', ['build', '-t', 'ecommbd-speed-varnish', 'infra/varnish']);
    await run('docker', [
        'run',
        '-d',
        '--name',
        name,
        '--add-host',
        'host.docker.internal:host-gateway',
        '-e',
        `STOREFRONT_PORT=${sitePort}`,
        '-e',
        `CACHE_PURGE_SECRET=${secret}`,
        '-p',
        `127.0.0.1:${cachePort}:80`,
        '-p',
        `127.0.0.1:${purgePort}:6082`,
        'ecommbd-speed-varnish',
    ]);
    let core = startCore();
    await ready(`${env.CORE_URL}/health`);
    let worker = startWorker();
    const frontend = start('storefront', 'node', ['apps/storefront/server.mjs'], {
        PORT: String(sitePort),
        HOST: '0.0.0.0',
    });
    if (frontend.exitCode !== null) throw new Error('Storefront did not start');
    await ready(site + '/health');

    // 1. The cache tests, and optionally every browser test through Varnish.
    await run('npx', ['playwright', 'test', '-c', 'playwright.speed.config.ts']);
    results.cacheTests = 'passed';
    if (process.env.SPEED_ALL_BROWSERS === '1') {
        await run('npx', ['playwright', 'test', '-c', 'playwright.speed-regression.config.ts']);
        results.browserSuite = 'passed';
    }

    // 2. Budgets, and proof that a broken budget fails.
    await run('npx', ['size-limit', '--config', '.size-limit.cjs']);
    await run('npx', ['lhci', 'autorun', '--config=.lighthouserc.cjs']);
    results.budgets = 'passed';
    fs.writeFileSync('.performance/oversize.js', randomBytes(32000));
    fs.writeFileSync(
        '.performance/negative-size.json',
        JSON.stringify([{ path: path.resolve('.performance/oversize.js'), limit: '1 B' }]),
    );
    const negative = spawnSync('npx', ['size-limit', '--config', '.performance/negative-size.json'], {
        env,
        encoding: 'utf8',
    });
    if (negative.status !== 1 || !/exceed/i.test(negative.stdout + negative.stderr))
        throw new Error('Oversized bundle did not fail for its size');
    fs.writeFileSync(
        '.performance/negative-lhci.cjs',
        "module.exports={ci:{assert:{assertions:{'largest-contentful-paint':['error',{maxNumericValue:0}]}}}};",
    );
    const negativeLh = spawnSync('npx', ['lhci', 'assert', '--config=.performance/negative-lhci.cjs'], {
        env,
        encoding: 'utf8',
    });
    if (
        negativeLh.status !== 1 ||
        !/largest-contentful-paint/.test(negativeLh.stdout + negativeLh.stderr) ||
        !/maxNumericValue/.test(negativeLh.stdout + negativeLh.stderr)
    )
        throw new Error('Exceeded Lighthouse budget did not fail for LCP');
    console.log('Both intentional budget violations were rejected.');
    results.negativeGates = 'passed';
    const urls = JSON.parse(fs.readFileSync('.performance/urls.json', 'utf8'));

    // 3. A core and worker restart (a deploy) purges nothing: the cached product page is the same
    // object afterwards. Two requests apart: a soft purge would serve the old object once, then a
    // new one.
    await fetch(urls.product);
    const before = await fetch(urls.product);
    if (before.headers.get('x-cache') !== 'HIT') throw new Error('The product page was not cached');
    await Promise.all([stop(core), stop(worker)]);
    core = startCore();
    await ready(`${env.CORE_URL}/health`);
    worker = startWorker();
    // Long enough for a start-up purge (batching is 2 s) and its re-render to have happened.
    await sleep(10000);
    for (let i = 0; i < 2; i++) {
        const after = await fetch(urls.product);
        if (after.headers.get('x-cache') !== 'HIT' || objectOf(after) !== objectOf(before))
            throw new Error('Restarting the core purged the cache');
        await sleep(500);
    }
    console.log('Restarting the core and worker left the cache alone.');
    results.coreRestart = 'passed';

    // 4. A Varnish restart empties the cache; the worker notices (within 10 s) and warms the top
    // pages. Each warmed page must then be a HIT for a shopper's own request (their Host), which
    // only holds if the warm-up filled the same entries.
    const admin = await adminApi();
    const restartedAt = Date.now();
    await run('docker', ['restart', name]);
    await ready(site + '/health');
    let warmed;
    const deadline = Date.now() + 60000;
    while (!warmed && Date.now() < deadline) {
        const { jobs } = await admin(
            `{ jobs(options: { filter: { queueName: { eq: "storefront-cache-warm" } }, take: 50 }) {
                items { state createdAt result } } }`,
        );
        warmed = jobs.items.find(
            job => job.state === 'COMPLETED' && new Date(job.createdAt).getTime() >= restartedAt - 1000,
        )?.result?.warmed;
        if (!warmed) await sleep(2000);
    }
    if (!warmed?.length) throw new Error('No warm-up ran after the Varnish restart');
    const missed = [];
    for (const page of warmed) {
        const response = await fetch(site + page);
        if (response.headers.get('x-cache') !== 'HIT') missed.push(page);
    }
    if (missed.length)
        throw new Error(`Warmed pages a shopper didn't get from the cache: ${missed.join(', ')}`);
    fs.writeFileSync('.performance/warmed.json', JSON.stringify(warmed, null, 2));
    const products = warmed.filter(page => page.startsWith('/product/')).length;
    console.log(
        `Varnish restart: ${warmed.length} pages warmed (the home page, ${warmed.length - products - 1} menu links, ` +
            `${products} products), each a HIT for a shopper's request.`,
    );
    results.restartWarmup = { warmed: warmed.length, products, shopperHits: warmed.length };

    // 5. Outage grace, then a hard purge.
    await fetch(urls.product);
    await stop(frontend);
    await fetch(env.CACHE_PURGE_URL, {
        method: 'PURGE',
        headers: { 'X-Purge-Token': secret, 'X-Purge-Tags': 'store17:store' },
    });
    const stale = await fetch(urls.product);
    if (stale.status !== 200 || stale.headers.get('x-cache') !== 'HIT')
        throw new Error('Outage grace did not serve stale HTML');
    console.log('Outage grace passed after the actual storefront process stopped.');
    results.outageGrace = 'passed';
    await fetch(env.CACHE_PURGE_URL, {
        method: 'PURGE',
        headers: { 'X-Purge-Token': secret, 'X-Purge-Tags': 'store17:store', 'X-Purge-Mode': 'hard' },
    });
    const unavailable = await fetch(urls.product);
    const page = await unavailable.text();
    if (unavailable.status !== 503) throw new Error('Hard invalidation did not remove outage grace');
    if (!page.includes('কিছুক্ষণের জন্য বন্ধ') || !page.includes('Temporarily unavailable'))
        throw new Error('Varnish did not serve its bilingual "unavailable" page');
    console.log('Hard invalidation removes stale content; Varnish answers with its bilingual 503 page.');
    results.hardInvalidation = 'passed';
    fs.writeFileSync(
        '.performance/result.json',
        JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2),
    );
} finally {
    await Promise.all(children.map(stop));
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    await db.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
    await db.end().catch(() => {});
}

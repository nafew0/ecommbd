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
const site = `http://localhost:${cachePort}`,
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
    CACHE_PURGE_URL: `http://localhost:${purgePort}/`,
    CACHE_PURGE_SECRET: secret,
    CACHE_WARM_URL: site,
    STOREFRONT_URL: site,
    SITE_URL: site,
    CORE_URL: `http://localhost:${corePort}`,
    EDITOR_ORIGIN: `http://localhost:${corePort}`,
    BROWSER_BASE_URL: `http://localhost:${corePort}`,
    VENDURE_SERVER_PORT: String(corePort),
    PORT: String(corePort),
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
function run(command, args = [], extra = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(command, args, { stdio: 'inherit', env, ...extra });
        p.on('error', reject);
        p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    });
}
function start(label, command, args, vars = {}) {
    const output = fs.openSync(`.performance/${label}.log`, 'w');
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
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('Service not ready: ' + url);
}
async function stop(p) {
    if (p.exitCode !== null) return;
    p.kill('SIGTERM');
    await Promise.race([once(p, 'exit'), new Promise(r => setTimeout(r, 11000))]);
    if (p.exitCode === null) p.kill('SIGKILL');
}
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
    start('core', 'node', ['apps/core/dist/index.js']);
    await ready(`${env.CORE_URL}/health`);
    start('worker', 'node', ['apps/core/dist/index-worker.js']);
    const frontend = start('storefront', 'node', ['apps/storefront/server.mjs'], {
        PORT: String(sitePort),
        HOST: '0.0.0.0',
    });
    // The storefront entry is relative to its workspace.
    if (frontend.exitCode !== null) throw new Error('Storefront did not start');
    await ready(site + '/health');
    await run('npx', ['playwright', 'test', '-c', 'playwright.speed.config.ts']);
    if (process.env.SPEED_ALL_BROWSERS === '1')
        await run('npx', ['playwright', 'test', '-c', 'playwright.speed-regression.config.ts']);
    await run('npx', ['size-limit', '--config', '.size-limit.cjs']);
    await run('npx', ['lhci', 'autorun', '--config=.lighthouserc.cjs']);
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
    // Restart removes all cached objects. No visitor request below warms a public page.
    await run('docker', ['restart', name]);
    await ready(site + '/health');
    const warmDeadline = Date.now() + 45000;
    let warmed = false;
    while (Date.now() < warmDeadline) {
        const stats = spawnSync('docker', ['exec', name, 'varnishstat', '-1', '-f', 'MAIN.n_object'], {
            encoding: 'utf8',
        });
        if (Number(stats.stdout.match(/MAIN\.n_object\s+(\d+)/)?.[1] ?? 0) > 0) {
            warmed = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!warmed) throw new Error('Restart warm-up did not populate Varnish');
    console.log('Varnish restart warm-up populated public objects without visitor requests.');
    const urls = JSON.parse(fs.readFileSync('.performance/urls.json', 'utf8'));
    await fetch(urls.product);
    await stop(frontend);
    await fetch(env.CACHE_PURGE_URL, {
        method: 'PURGE',
        headers: { 'X-Purge-Token': secret, 'X-Purge-Tags': 'store17:catalog' },
    });
    const stale = await fetch(urls.product);
    if (stale.status !== 200 || stale.headers.get('x-cache') !== 'HIT')
        throw new Error('Outage grace did not serve stale HTML');
    console.log('Outage grace passed after the actual storefront process stopped.');
    await fetch(env.CACHE_PURGE_URL, {
        method: 'PURGE',
        headers: { 'X-Purge-Token': secret, 'X-Purge-Tags': 'store17:store', 'X-Purge-Mode': 'hard' },
    });
    const unavailable = await fetch(urls.product);
    if (unavailable.status !== 503) throw new Error('Hard invalidation did not remove outage grace');
    console.log('Hard invalidation removes stale content for maintenance/suspension operations.');
    fs.writeFileSync(
        '.performance/result.json',
        JSON.stringify(
            {
                at: new Date().toISOString(),
                browser: 'passed',
                budgets: 'passed',
                negativeGates: 'passed',
                restartWarmup: 'passed',
                outageGrace: 'passed',
                hardInvalidation: 'passed',
            },
            null,
            2,
        ),
    );
} finally {
    await Promise.all(children.map(stop));
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    await db.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
    await db.end().catch(() => {});
}

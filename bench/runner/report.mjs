#!/usr/bin/env node
// Prints markdown comparison tables from results/<engine>-run*.json.
// Usage: node runner/report.mjs

import fs from 'node:fs';
import path from 'node:path';

const RESULTS_DIR = path.resolve(import.meta.dirname, '..', 'results');
const STEPS = ['product', 'addToCart', 'customerAddress', 'shippingOptions', 'setShipping', 'payment', 'placeOrder', 'total'];
const ENGINES = ['vendure', 'medusa'];

const runs = {};
for (const file of fs.readdirSync(RESULTS_DIR)) {
    const m = file.match(/^(vendure|medusa)-(run\d+)\.json$/);
    if (!m) continue;
    (runs[m[1]] ??= []).push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8')));
}

const avg = values => values.reduce((a, b) => a + b, 0) / values.length;
const ms = v => `${Math.round(v)} ms`;
const mean = (engine, pick) => avg(runs[engine].map(pick));
const ratio = (v, m) => `${(m / v).toFixed(1)}×`;

console.log(`Runs per engine: ${ENGINES.map(e => `${e} ${runs[e]?.length ?? 0}`).join(', ')} (values are the mean across runs)\n`);

console.log('| | Vendure | Medusa | Medusa ÷ Vendure |');
console.log('|---|---|---|---|');
const rows = [
    ['Boot to healthy', r => r.bootSeconds, v => `${v.toFixed(1)} s`],
    ['Memory idle', r => r.memoryMb.idle, v => `${Math.round(v)} MB`],
    ['Memory peak under load', r => r.memoryMb.peak, v => `${Math.round(v)} MB`],
    ['Memory after load', r => r.memoryMb.afterLoad, v => `${Math.round(v)} MB`],
    ['Checkout p50, 1 shopper', r => r.sequential.stats.total.p50, ms],
    ['Checkout p95, 1 shopper', r => r.sequential.stats.total.p95, ms],
    ['Checkout p50, 10 shoppers', r => r.concurrent.stats.total.p50, ms],
    ['Checkout p95, 10 shoppers', r => r.concurrent.stats.total.p95, ms],
    ['Throughput, 10 shoppers', r => r.concurrent.checkoutsPerSecond, v => `${v.toFixed(1)} checkouts/s`],
    ['Failed checkouts', r => r.sequential.errors + r.concurrent.errors, v => `${v}`],
];
for (const [label, pick, fmt] of rows) {
    const v = mean('vendure', pick);
    const m = mean('medusa', pick);
    const r = label.startsWith('Throughput') ? `${(m / v).toFixed(2)}×` : label.startsWith('Failed') ? '' : ratio(v, m);
    console.log(`| ${label} | ${fmt(v)} | ${fmt(m)} | ${r} |`);
}

for (const [phase, title] of [['sequential', '1 shopper'], ['concurrent', '10 shoppers']]) {
    console.log(`\n**Per step p95, ${title}**\n`);
    console.log('| Step | Vendure | Medusa |');
    console.log('|---|---|---|');
    for (const step of STEPS) {
        console.log(`| ${step} | ${ms(mean('vendure', r => r[phase].stats[step].p95))} | ${ms(mean('medusa', r => r[phase].stats[step].p95))} |`);
    }
}

console.log('\n**Run-to-run spread (checkout p95, 10 shoppers)**\n');
for (const engine of ENGINES) {
    console.log(`- ${engine}: ${runs[engine].map(r => `${r.label} ${ms(r.concurrent.stats.total.p95)}`).join(', ')}`);
}

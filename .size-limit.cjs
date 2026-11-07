/* eslint-disable @typescript-eslint/no-require-imports -- size-limit loads CommonJS configuration. */
/**
 * JavaScript budgets for the storefront's built files (roadmap phase 17, architecture.md
 * Decision 2), gzipped, checked by `npm run test:speed` and CI after `npm run build`.
 *
 * - Every file: 30 kB, or 45 kB for checkout and sales-page scripts.
 * - The speed beacon, which every page with it ships: its loader within 600 B, and web-vitals
 *   (loaded by sampled visits only) within 3.5 kB. See docs/decisions.md, 2026-10-23.
 */
const fs = require('node:fs');
const path = require('node:path');
const dir = 'apps/storefront/dist/client/_astro';

function limit(file) {
    if (/^VitalsBeacon\./.test(file)) return '600 B';
    if (/^web-vitals\./.test(file)) return '3.5 kB';
    return /checkout|sales|order-form/i.test(file) ? '45 kB' : '30 kB';
}

module.exports = fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.js'))
    .map(file => ({ name: file, path: path.join(dir, file), limit: limit(file), gzip: true }));

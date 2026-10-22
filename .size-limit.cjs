/* eslint-disable @typescript-eslint/no-require-imports -- size-limit loads CommonJS configuration. */
const fs = require('node:fs');
const path = require('node:path');
const dir = 'apps/storefront/dist/client/_astro';
module.exports = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => ({
        name: f,
        path: path.join(dir, f),
        limit: /checkout|sales|order-form/i.test(f) ? '45 kB' : '30 kB',
        gzip: true,
    }));

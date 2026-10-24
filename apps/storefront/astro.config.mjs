import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = process.env.CORE_URL ?? 'http://localhost:3000';

/**
 * The storefront (roadmap phase 12): server-rendered, no JavaScript by default. Built in Node
 * middleware mode and served by our own `server.mjs` (health, shutdown, logs, static files).
 */
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'middleware' }),
    // Islands (cart, variant picker) arrive in phase 14.
    integrations: [preact()],
    // Our middleware redirects to the trailing-slash form itself (one 301 to the canonical URL).
    trailingSlash: 'ignore',
    // Stylesheets as files, so the Content Security Policy needs no 'unsafe-inline'.
    build: { inlineStylesheets: 'never' },
    devToolbar: { enabled: false },
    vite: {
        // Bundle the server's dependencies in the build: in this monorepo, packages hoisted for the core
        // (an older `cookie`, for one) would otherwise be picked up at runtime instead of Astro's own.
        // Not in `astro dev`: its module runner can't run CommonJS packages ("require is not defined").
        ssr: { noExternal: process.argv.includes('dev') ? [] : true },
        resolve: {
            alias: {
                '@ecommbd/shared': path.resolve(here, '../../packages/shared/src'),
                // Sections and themes (phase 15): browser-safe, straight from the source like shared.
                '@ecommbd/sections': path.resolve(here, '../../packages/sections/src/index.ts'),
            },
        },
        // `astro dev`: images and the Shop API come from the core, as Nginx does in production.
        server: {
            proxy: Object.fromEntries(['/img', '/assets', '/shop-api', '/bd-pay', '/bd-courier', '/bd-events'].map(prefix => [prefix, core])),
        },
    },
});

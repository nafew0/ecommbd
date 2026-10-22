import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const core = process.env.CORE_URL ?? 'http://localhost:3000';

/**
 * The admin is built to static files in dist/ and served by the core at /admin (same origin as the
 * Admin API). `npm run dev -w @ecommbd/admin` serves it with live reload on :5174 and forwards API
 * calls to the core on :3000.
 */
export default defineConfig({
    base: '/admin/',
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            // Browser-safe helpers straight from the source (phone, text, money, time, store-settings).
            // Never import the package root here: it includes Node-only code (HTTP client, crypto).
            '@ecommbd/shared': path.resolve(__dirname, '../../packages/shared/src'),
            // Sections and themes (phase 15): the whole package is browser-safe.
            '@ecommbd/sections': path.resolve(__dirname, '../../packages/sections/src/index.ts'),
        },
    },
    build: {
        outDir: 'dist',
        // Everything as files: the Content Security Policy allows fonts and scripts only from 'self'.
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 350,
        rollupOptions: {
            output: {
                // React and the router change rarely: their own chunk stays cached across our releases.
                manualChunks(id) {
                    return /node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)
                        ? 'vendor'
                        : undefined;
                },
            },
        },
    },
    server: {
        port: 5174,
        proxy: Object.fromEntries(
            ['/admin-api', '/shop-api', '/assets', '/bd-geo'].map(route => [route, core]),
        ),
    },
});

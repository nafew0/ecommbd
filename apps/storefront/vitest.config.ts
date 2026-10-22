import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests: URL and slug helpers, SEO output, formatting, the data cache. */
export default defineConfig({
    resolve: {
        alias: {
            '@ecommbd/shared': path.resolve(__dirname, '../../packages/shared/src'),
            '@ecommbd/sections': path.resolve(__dirname, '../../packages/sections/src/index.ts'),
        },
    },
    test: { name: 'storefront', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], environment: 'node' },
});

import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests for the admin's plain logic (no browser). Screens are tested with Playwright. */
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@ecommbd/shared': path.resolve(__dirname, '../../packages/shared/src'),
        },
    },
    test: {
        name: 'admin',
        include: ['src/**/*.spec.{ts,tsx}'],
        environment: 'node',
    },
});

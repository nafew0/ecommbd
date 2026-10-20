import { defineConfig } from 'vitest/config';
import { decoratorPlugin } from './vitest.shared.mts';

/**
 * End-to-end tests: a real Vendure server against PostgreSQL (root docker-compose.yml locally,
 * service containers in CI). Each test file gets its own database and its own port.
 */
export default defineConfig({
    plugins: [decoratorPlugin],
    test: {
        name: 'core-e2e',
        include: ['test/e2e/**/*.e2e-spec.ts'],
        environment: 'node',
        testTimeout: 30_000,
        hookTimeout: 120_000,
    },
});

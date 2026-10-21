import { defineConfig } from 'vitest/config';
import { decoratorPlugin } from './vitest.shared.mts';

/** Unit tests: fast, no database. End-to-end tests use vitest.e2e.config.mts. */
export default defineConfig({
    plugins: [decoratorPlugin],
    test: {
        name: 'core',
        include: ['test/unit/**/*.spec.ts'],
        environment: 'node',
        // Like the server (src/env.ts): Vendure's timestamps are only consistent in UTC.
        env: { TZ: 'UTC' },
    },
});

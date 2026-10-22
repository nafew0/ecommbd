import { defineConfig } from 'vitest/config';
import { decoratorPlugin } from './vitest.shared.mts';
export default defineConfig({
    plugins: [decoratorPlugin],
    test: {
        include: ['test/performance/woo-throughput.spec.ts'],
        environment: 'node',
        env: { TZ: 'UTC' },
        testTimeout: 3600000,
        hookTimeout: 120000,
    },
});

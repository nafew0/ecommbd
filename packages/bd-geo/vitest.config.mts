import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'bd-geo',
        include: ['src/**/*.spec.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.spec.ts', 'src/index.ts'],
            reporter: ['text', 'json-summary'],
            thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
        },
    },
});

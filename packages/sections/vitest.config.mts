import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'sections',
        include: ['src/**/*.spec.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.spec.ts', 'src/index.ts'],
            reporter: ['text', 'json-summary'],
            thresholds: { branches: 95, functions: 100, lines: 100, statements: 100 },
        },
    },
});

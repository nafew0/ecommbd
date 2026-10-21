// Lint rules for the whole repo (`npm run lint`). Recommended rules only; formatting is
// Prettier's job (`npm run format`).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            'bench/**',
            'apps/core/src/gql/**',
            'apps/core/src/migrations/**',
            'apps/core/static/**',
            // Generated: Astro's types and the Shop API schema types (gql.tada).
            'apps/storefront/.astro/**',
            'apps/storefront/src/gql/**',
            'playwright-report/**',
            'test-results/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.node },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
        },
    },
    {
        // The storefront's server: plain Node.
        files: ['apps/storefront/server.mjs'],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        // The merchant admin runs in the browser.
        files: ['apps/admin/src/**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.browser } },
    },
    prettier,
);

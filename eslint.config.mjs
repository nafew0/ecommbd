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
        // The merchant admin runs in the browser.
        files: ['apps/admin/src/**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.browser } },
    },
    prettier,
);

import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (`npm run test:browser`). Playwright starts the built app (`npm run start`)
 * unless one is already running locally. Build first with `npm run build`.
 *
 * Two projects: a desktop browser, and a phone (Pixel 7) for the merchant admin, which merchants
 * mostly use on their phones. Tests that only make sense on one of them say so with `test.skip`.
 */
const baseURL = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';
const storefrontURL = process.env.STOREFRONT_URL ?? 'http://localhost:4321';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    // The tests share one store (and its settings), so they run one at a time.
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL,
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'phone', use: { ...devices['Pixel 7'] } },
    ],
    webServer: [
        {
            command: 'npm run start',
            url: `${baseURL}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
        },
        {
            // The storefront (storefront.spec.ts), talking to the core above.
            command: 'npm run start -w @ecommbd/storefront',
            url: `${storefrontURL}/health`,
            env: { CORE_URL: baseURL, SITE_URL: storefrontURL, PORT: new URL(storefrontURL).port || '4321' },
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
        },
    ],
});

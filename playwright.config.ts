import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (`npm run test:browser`). Playwright starts the built app (`npm run start`)
 * unless one is already running locally. Build first with `npm run build`.
 */
const baseURL = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL,
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'npm run start',
        url: `${baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});

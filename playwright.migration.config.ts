import { defineConfig, devices } from '@playwright/test';
process.env.BROWSER_BASE_URL ??= 'http://localhost:3096';
process.env.STOREFRONT_URL ??= 'http://localhost:4396';
export default defineConfig({
    testDir: './tests/browser',
    testMatch: 'woo-migration.spec.ts',
    timeout: 90000,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-migration' }]],
    use: { baseURL: process.env.BROWSER_BASE_URL ?? 'http://localhost:3096', trace: 'retain-on-failure' },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'phone', use: { ...devices['Pixel 7'] } },
    ],
});

import { defineConfig, devices } from '@playwright/test';
process.env.BROWSER_BASE_URL ??= 'http://localhost:3197';
process.env.STOREFRONT_URL ??= 'http://localhost:6085';
export default defineConfig({
    testDir: './tests/speed',
    timeout: 60000,
    workers: 1,
    reporter: 'list',
    use: { ...devices['Pixel 7'], trace: 'retain-on-failure' },
});

/* eslint-disable @typescript-eslint/no-require-imports -- Lighthouse CI loads CommonJS configuration. */
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const urls = JSON.parse(fs.readFileSync('.performance/urls.json', 'utf8'));
module.exports = {
    ci: {
        collect: {
            url: [urls.product, urls.sales],
            numberOfRuns: 3,
            chromePath: chromium.executablePath(),
            settings: {
                chromeFlags: '--no-sandbox --headless',
                onlyCategories: ['performance'],
                formFactor: 'mobile',
                throttlingMethod: 'simulate',
                throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['error', { minScore: 0.95 }],
                'largest-contentful-paint': ['error', { maxNumericValue: 1500, aggregationMethod: 'median' }],
                'cumulative-layout-shift': ['error', { maxNumericValue: 0.099, aggregationMethod: 'median' }],
                'total-blocking-time': ['error', { maxNumericValue: 199, aggregationMethod: 'median' }],
            },
        },
        upload: { target: 'filesystem', outputDir: '.performance/lighthouse' },
    },
};

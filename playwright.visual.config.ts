import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Visual regression snapshots (`npm run test:visual`, roadmap phase 15): every section in both
 * themes and both languages, on a phone and a computer. Separate from `test:browser` because
 * screenshots depend on the operating system's fonts: the baselines in tests/visual/__screenshots__
 * are per platform (`-darwin`, `-linux`). After a deliberate design change, update them with
 * `npm run test:visual -- --update-snapshots` and review the new images before committing.
 */
export default defineConfig({
    ...base,
    testDir: './tests/visual',
    testMatch: '**/*.visual.ts',
    timeout: 120_000,
    snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
            animations: 'disabled',
            caret: 'hide',
        },
    },
    use: { ...base.use, reducedMotion: 'reduce' },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
        {
            name: 'phone',
            use: {
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 1,
                isMobile: true,
                hasTouch: true,
            },
        },
    ],
});

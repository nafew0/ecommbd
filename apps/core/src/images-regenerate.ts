import { bootstrapWorker } from '@vendure/core';
import { BdImageService } from './plugins/bd-images';
import { config } from './vendure-config';

/**
 * `npm run images:regenerate -- --all` remakes the WebP sizes of every image, e.g. after a change of
 * quality or widths; `-- --asset <id>` remakes one asset's. Run it with the server up or down.
 */
async function main() {
    const args = process.argv.slice(2);
    const assetIndex = args.indexOf('--asset');
    const assetId = assetIndex >= 0 ? args[assetIndex + 1] : undefined;
    if (!args.includes('--all') && !assetId) {
        console.error('Usage: npm run images:regenerate -- --all | --asset <id>');
        process.exit(2);
    }
    const { app } = await bootstrapWorker(config);
    try {
        const started = Date.now();
        const { done, failed } = await app.get(BdImageService).regenerate({
            assetId,
            onProgress: (doneSoFar, failedSoFar) => {
                if ((doneSoFar + failedSoFar) % 25 === 0)
                    console.log(`… ${doneSoFar} done, ${failedSoFar} failed`);
            },
        });
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(
            `✓ ${done} images regenerated in ${seconds} s${failed ? `; ${failed} failed (see the log)` : ''}`,
        );
        if (failed) process.exitCode = 1;
    } finally {
        await app.close();
    }
}

// Exits explicitly: the job queue's Redis connections would otherwise keep the process alive.
main().then(
    () => process.exit(process.exitCode ?? 0),
    error => {
        console.error(error);
        process.exit(1);
    },
);

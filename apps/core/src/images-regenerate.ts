import { bootstrapWorker } from '@vendure/core';
import { ImageVariantsService } from './plugins/images';
import { config } from './vendure-config';

/**
 * `npm run images:regenerate -- --all` remakes every image's WebP sizes (after changing sizes or
 * quality); `-- --asset <id>` remakes one.
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
        const count = await app.get(ImageVariantsService).regenerate(assetId);
        console.log(`✓ ${count} image${count === 1 ? '' : 's'} processed`);
    } finally {
        await app.close();
    }
}

// Exits explicitly: the job queue's Redis connections would otherwise keep the process alive.
main().then(
    () => process.exit(0),
    error => {
        console.error(error);
        process.exit(1);
    },
);

import { bootstrapWorker, runMigrations } from '@vendure/core';
import { StoreDefaultsService } from './plugins/bd-core';
import { config } from './vendure-config';

/**
 * `npm run store:init` sets up Bangladesh store defaults now, instead of waiting for the next
 * server start. It only creates what is missing.
 *
 * `npm run store:init -- --force` (operations staff only) also re-applies the defaults a merchant
 * may have changed since, such as the channel's currency and languages.
 */
async function main() {
    const force = process.argv.includes('--force');
    await runMigrations(config);
    const { app } = await bootstrapWorker(config);
    try {
        const report = await app.get(StoreDefaultsService).run({ force });
        for (const step of report) {
            const detail =
                step.status === 'skipped' ? 'already done' : step.notes.join('; ') || 'nothing needed';
            console.log(`${step.status === 'done' ? '✓' : '·'} ${step.id}: ${detail}`);
        }
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

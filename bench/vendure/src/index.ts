import { bootstrap, JobQueueService } from '@vendure/core';
import { config } from './vendure-config';

// Server and job worker in one process, the per-store setup in docs/architecture.md.
bootstrap(config)
    .then(app => app.get(JobQueueService).start())
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

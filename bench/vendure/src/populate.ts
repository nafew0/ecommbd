import { bootstrap, JobQueueService, mergeConfig } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import path from 'path';
import { config } from './vendure-config';

// Creates the schema and loads Vendure's standard sample data (the same data @vendure/create uses).
const assetsDir = path.dirname(require.resolve('@vendure/create/assets/initial-data.json'));
const initialData = require(path.join(assetsDir, 'initial-data.json'));

const populateConfig = mergeConfig(config, {
    dbConnectionOptions: { synchronize: true },
    importExportOptions: { importAssetsDir: path.join(assetsDir, 'images') },
});

populate(
    () => bootstrap(populateConfig).then(async app => {
        await app.get(JobQueueService).start();
        return app;
    }),
    initialData,
    path.join(assetsDir, 'products.csv'),
)
    .then(app => app.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

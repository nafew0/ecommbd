import {
    DefaultLogger,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    LogLevel,
    RedisCachePlugin,
    VendureConfig,
} from '@vendure/core';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { BullMQJobQueuePlugin } from '@vendure/job-queue-plugin/package/bullmq';
import path from 'path';

// Production-like setup for the benchmark: Postgres, BullMQ job queue and cache on Redis,
// no dashboard, GraphiQL or email plugin (Medusa runs with its admin disabled too).
const redis = { host: '127.0.0.1', port: 56379 };

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        cors: { origin: ['http://localhost:8000'], credentials: true },
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: { identifier: 'bench-admin', password: 'bench-admin-local-only-7f3k' },
        cookieOptions: { secret: 'bench-cookie-secret' },
    },
    dbConnectionOptions: {
        type: 'postgres',
        host: '127.0.0.1',
        port: 55432,
        username: 'bench',
        password: 'bench',
        database: 'vendure',
        synchronize: false,
        logging: false,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    logger: new DefaultLogger({ level: LogLevel.Warn }),
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
        }),
        DefaultSchedulerPlugin.init(),
        BullMQJobQueuePlugin.init({ connection: { ...redis, maxRetriesPerRequest: null } }),
        RedisCachePlugin.init({ redisOptions: redis, namespace: 'vendure-bench' }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
    ],
};

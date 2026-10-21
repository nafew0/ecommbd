import {
    dummyPaymentHandler,
    TransactionalConnection,
    type InitialData,
    LanguageCode,
    mergeConfig,
    type VendureConfig,
} from '@vendure/core';
import { testConfig, type TestServer } from '@vendure/testing';
import path from 'node:path';
import { requestIdMiddleware } from '../../src/logging/request-context';
import { type CustomPluginOptions, customPlugins } from '../../src/plugins';
import { CREATE_ORDER_NUMBER_SEQUENCE_SQL } from '../../src/plugins/bd-orders';

/**
 * Vendure's test config, plus what our real config adds (our plugins and middleware), against
 * PostgreSQL and the cache Redis. Each test file passes its own port, so files can run in parallel.
 * Connection settings come from TEST_DB_* and TEST_REDIS_CACHE_* variables, defaulting to the root
 * docker-compose.yml. Redis keys get a prefix of their own per run.
 */
export function createTestConfig(
    port: number,
    overrides: Partial<VendureConfig> = {},
    pluginOptions: Partial<CustomPluginOptions> = {},
): Required<VendureConfig> {
    const ours = mergeConfig(testConfig, {
        // Same API protection as vendure-config.ts.
        apiOptions: { port, csrfPrevention: true },
        dbConnectionOptions: {
            type: 'postgres',
            host: process.env.TEST_DB_HOST ?? '127.0.0.1',
            port: Number(process.env.TEST_DB_PORT ?? 54320),
            username: process.env.TEST_DB_USERNAME ?? 'ecommbd',
            password: process.env.TEST_DB_PASSWORD ?? 'ecommbd',
        },
        paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
        plugins: customPlugins({
            defaultLanguage: 'bn',
            cacheRedis: {
                host: process.env.TEST_REDIS_CACHE_HOST ?? '127.0.0.1',
                port: Number(process.env.TEST_REDIS_CACHE_PORT ?? 63791),
            },
            redisKeyPrefix: `test-${port}-${Date.now()}`,
            ...pluginOptions,
        }),
    });
    const config = mergeConfig(ours, overrides);
    // Set after merging: mergeConfig's partial type doesn't accept middleware functions.
    config.apiOptions.middleware = [
        { handler: requestIdMiddleware, route: 'shop-api' },
        { handler: requestIdMiddleware, route: 'admin-api' },
    ];
    return config;
}

/**
 * Store data for tests. Countries, the Bangladesh zone, tax and the channel come from our own
 * store-defaults initializer (bd-core), which runs when the test server first starts; this only
 * adds what tests need on top.
 */
export const testInitialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Bangladesh',
    taxRates: [],
    // Delivery methods come from shipping-bd's store defaults (Standard ৳60 in Dhaka city).
    shippingMethods: [],
    paymentMethods: [
        {
            name: 'Test payment',
            handler: {
                code: dummyPaymentHandler.code,
                arguments: [{ name: 'automaticSettle', value: 'false' }],
            },
        },
    ],
    countries: [],
    collections: [],
};

/** Two products for checkout tests: a panjabi (500 in stock) and a saree (5 in stock). */
export const testProductsCsvPath = path.join(__dirname, '../fixtures/products.csv');

/**
 * Test databases are built from the entities (Vendure's `synchronize`), not from our migrations, so
 * this adds what only migrations create: the order-number sequence. Call it after `server.init()`.
 */
export async function addMigrationOnlyObjects(server: TestServer) {
    await server.app.get(TransactionalConnection).rawConnection.query(CREATE_ORDER_NUMBER_SEQUENCE_SQL);
}

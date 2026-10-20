import {
    dummyPaymentHandler,
    type InitialData,
    LanguageCode,
    mergeConfig,
    type VendureConfig,
} from '@vendure/core';
import { testConfig } from '@vendure/testing';
import { requestIdMiddleware } from '../../src/logging/request-context';
import { customPlugins } from '../../src/plugins';

/**
 * Vendure's test config, plus what our real config adds (our plugins and middleware), against
 * PostgreSQL. Each test file passes its own port, so files can run in parallel.
 * Connection settings come from TEST_DB_* variables, defaulting to the root docker-compose.yml.
 */
export function createTestConfig(
    port: number,
    overrides: Partial<VendureConfig> = {},
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
        plugins: customPlugins(),
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
    shippingMethods: [{ name: 'Standard delivery', price: 6000 }],
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

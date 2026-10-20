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
        apiOptions: { port },
        dbConnectionOptions: {
            type: 'postgres',
            host: process.env.TEST_DB_HOST ?? '127.0.0.1',
            port: Number(process.env.TEST_DB_PORT ?? 54320),
            username: process.env.TEST_DB_USERNAME ?? 'ecommbd',
            password: process.env.TEST_DB_PASSWORD ?? 'ecommbd',
        },
        paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
        plugins: [...customPlugins],
    });
    const config = mergeConfig(ours, overrides);
    // Set after merging: mergeConfig's partial type doesn't accept middleware functions.
    config.apiOptions.middleware = [
        { handler: requestIdMiddleware, route: 'shop-api' },
        { handler: requestIdMiddleware, route: 'admin-api' },
    ];
    return config;
}

/** Minimal store data for tests. Phase 02 replaces this with the real Bangladesh defaults. */
export const testInitialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Asia',
    taxRates: [{ name: 'Standard', percentage: 0 }],
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
    countries: [{ name: 'Bangladesh', code: 'BD', zone: 'Asia' }],
    collections: [],
};

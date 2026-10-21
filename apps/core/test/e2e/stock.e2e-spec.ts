import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareCheckout, TRANSITION } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3060;
const config = createTestConfig(PORT, {}, { checkoutRateLimits: undefined });
const { server, adminClient } = createTestEnvironment(config);
const shopUrl = `http://localhost:${PORT}/shop-api`;

const VARIANT = gql`
    query ($id: ID!) {
        productVariant(id: $id) {
            stockOnHand
            stockAllocated
        }
    }
`;

const UPDATE_VARIANTS = gql`
    mutation ($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`;

const PAY = gql`
    mutation {
        addPaymentToOrder(input: { method: "bd-cod", metadata: {} }) {
            ... on Order {
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PaymentDeclinedError {
                paymentErrorMessage
            }
        }
    }
`;

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 0,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('stock under concurrency', () => {
    it('50 shoppers buying at the same moment from 10 in stock place exactly 10 orders', async () => {
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: 'T_2', stockOnHand: 10 }] });
        const shoppers = Array.from({ length: 50 }, () => new SimpleGraphQLClient(config, shopUrl));
        // Every cart is filled first (each sees stock available), then all pay at once.
        for (const [index, shop] of shoppers.entries()) {
            await prepareCheckout(shop, {
                phone: `0171300${String(index).padStart(4, '0')}`,
                variantId: 'T_2',
            });
            await shop.query(TRANSITION, { state: 'ArrangingPayment' });
        }
        const results = await Promise.all(
            shoppers.map(shop => shop.query(PAY).then(r => r.addPaymentToOrder)),
        );
        const placed = results.filter(result => result.state === 'PaymentAuthorized');
        expect(placed).toHaveLength(10);
        // The other 40 are told plainly, and no payment is left on their carts.
        const refused = results.filter(result => result.state !== 'PaymentAuthorized');
        expect(refused).toHaveLength(40);
        for (const result of refused) {
            expect(result).toMatchObject({ errorCode: 'PAYMENT_DECLINED_ERROR' });
            expect(result.paymentErrorMessage).toMatch(/^Sorry, just sold out: Silk Saree/);
        }
        const { productVariant } = await adminClient.query(VARIANT, { id: 'T_2' });
        expect(productVariant).toEqual({ stockOnHand: 10, stockAllocated: 10 });
    }, 120_000);
});

import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placePhoneOrder } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

/**
 * Eid volume (roadmap phase 04): the confirmation queue, the status counts, a phone search and the
 * widgets stay fast with 20,000 placed orders, 3,000 of them New. Orders are copied in SQL from one
 * real order, so this takes seconds, not hours.
 */
registerInitializer('postgres', new PostgresInitializer());

const ORDERS = 20_000;
const NEW_ORDERS = 3_000;
/** Generous for CI machines; locally each query takes a few tens of milliseconds. */
const BUDGET_MS = 1_500;

const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(3056));

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
    const template = await placePhoneOrder(shopClient, { phone: '01911000001' });
    const db = server.app.get(TransactionalConnection).rawConnection;
    const columns: Array<{ column_name: string }> = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'order' AND column_name <> 'id'`,
    );
    const overrides: Record<string, string> = {
        code: `'LOAD' || n`,
        state: `CASE WHEN n <= ${NEW_ORDERS} THEN 'PaymentAuthorized' WHEN n % 3 = 0 THEN 'Delivered' ELSE 'Confirmed' END`,
        orderPlacedAt: `now() - (n || ' minutes')::interval`,
        customFieldsOrdernumber: `(100000 + n)::text`,
        customFieldsConfirmqueueat: `CASE WHEN n <= ${NEW_ORDERS} THEN now() - (n || ' minutes')::interval END`,
        // Unique per order, and given at placement (phase 14): the copies get none.
        customFieldsTrackingtoken: 'NULL',
    };
    const names = columns.map(column => `"${column.column_name}"`).join(', ');
    const values = columns
        .map(column => overrides[column.column_name] ?? `o."${column.column_name}"`)
        .join(', ');
    const templateId = template.id.replace(/^T_/, '');
    await db.query(
        `INSERT INTO "order" (${names})
         SELECT ${values} FROM "order" o, generate_series(1, ${ORDERS}) n WHERE o.id = $1`,
        [templateId],
    );
    await db.query(
        `INSERT INTO "order_channels_channel" ("orderId", "channelId")
         SELECT o.id, c."channelId" FROM "order" o, "order_channels_channel" c
         WHERE o.code LIKE 'LOAD%' AND c."orderId" = $1`,
        [templateId],
    );
    await db.query('ANALYZE "order"');
}, 180_000);

afterAll(async () => {
    await server.destroy();
});

async function timed<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const start = performance.now();
    const result = await work();
    return { result, ms: performance.now() - start };
}

describe('order lists at Eid volume', () => {
    it('serves the confirmation queue, counts, a phone search and the widgets within budget', async () => {
        const queue = await timed(() =>
            adminClient.query(gql`
                {
                    bdConfirmationQueue(take: 50) {
                        totalItems
                        items {
                            id
                            customFields {
                                orderNumber
                            }
                            bd {
                                status
                                paymentType
                            }
                        }
                    }
                }
            `),
        );
        expect(queue.result.bdConfirmationQueue.totalItems).toBe(NEW_ORDERS + 1);
        expect(queue.result.bdConfirmationQueue.items).toHaveLength(50);
        // Oldest first.
        expect(queue.result.bdConfirmationQueue.items[0].customFields.orderNumber).toBe(
            String(100000 + NEW_ORDERS),
        );

        const counts = await timed(() =>
            adminClient.query(gql`
                {
                    bdOrderCounts {
                        status
                        count
                    }
                }
            `),
        );
        const search = await timed(() =>
            adminClient.query(gql`
                {
                    bdOrders(search: "000001", take: 25) {
                        totalItems
                    }
                }
            `),
        );
        const stats = await timed(() =>
            adminClient.query(gql`
                {
                    bdOrderStats {
                        todayOrders
                        waitingConfirmation
                    }
                }
            `),
        );
        expect(stats.result.bdOrderStats.waitingConfirmation).toBe(NEW_ORDERS + 1);
        expect(search.result.bdOrders.totalItems).toBeGreaterThan(0);

        const timings = { queue: queue.ms, counts: counts.ms, search: search.ms, stats: stats.ms };
        console.log(`Order list timings with ${ORDERS} orders (ms):`, timings);
        for (const ms of Object.values(timings)) {
            expect(ms).toBeLessThan(BUDGET_MS);
        }
    });

    it('uses the queue index rather than reading every order', async () => {
        const db = server.app.get(TransactionalConnection).rawConnection;
        const plan: Array<{ 'QUERY PLAN': string }> = await db.query(
            `EXPLAIN SELECT id FROM "order" WHERE "customFieldsConfirmqueueat" <= now()
             ORDER BY "customFieldsConfirmqueueat" LIMIT 50`,
        );
        expect(plan.map(row => row['QUERY PLAN']).join('\n')).toMatch(/Index Scan/);
    });
});

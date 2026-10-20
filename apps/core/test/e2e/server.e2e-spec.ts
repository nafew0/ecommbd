import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestConfig, testInitialData } from '../support/test-config';

// A real Vendure server with our plugins, against PostgreSQL (see test/support/test-config.ts).
registerInitializer('postgres', new PostgresInitializer());

const PORT = 3051;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 1 });
    await adminClient.asSuperAdmin();
});

afterAll(async () => {
    await server.destroy();
});

describe('server', () => {
    it('answers the Shop API', async () => {
        const result = await shopClient.query<{ activeChannel: { code: string } }>(gql`
            query {
                activeChannel {
                    code
                }
            }
        `);
        expect(result.activeChannel.code).toBe('__default_channel__');
    });

    it('lets the superadmin use the Admin API', async () => {
        const result = await adminClient.query<{ administrators: { totalItems: number } }>(gql`
            query {
                administrators {
                    totalItems
                }
            }
        `);
        expect(result.administrators.totalItems).toBeGreaterThan(0);
    });

    it('returns a request ID on every API response', async () => {
        const call = (headers: Record<string, string> = {}) =>
            fetch(`http://localhost:${PORT}/shop-api`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify({ query: '{ activeChannel { code } }' }),
            });
        expect((await call({ 'x-request-id': 'test-request-1234' })).headers.get('x-request-id')).toBe(
            'test-request-1234',
        );
        expect((await call()).headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });
});

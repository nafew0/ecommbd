import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import { DefaultSearchPlugin, RequestContextService, TransactionalConnection, User } from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestConfig, testInitialData, addMigrationOnlyObjects } from '../support/test-config';
import { WooHelperService, HELPER_STAGES, chunkSignature } from '../../src/plugins/woo-import/helper.service';
import { WooImportService } from '../../src/plugins/woo-import/woo-import.service';
import { WooRun } from '../../src/plugins/woo-import/entities';
import { WooRecord } from '../../src/plugins/woo-import/helpers';
registerInitializer('postgres', new PostgresInitializer());
const config = createTestConfig(
    3075,
    {},
    {
        wooImportKeys: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
        wooPublicUrl: 'https://benchmark.example',
    },
);
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: true }));
const { server, adminClient } = createTestEnvironment(config);
beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 0 });
    await adminClient.asSuperAdmin();
    await addMigrationOnlyObjects(server);
}, 120000);
afterAll(async () => {
    await server.destroy();
});
it('imports 500 synthetic products (including 201 variations) and 20,000 exact historical orders', async () => {
    const db = server.app.get(TransactionalConnection);
    const helper = server.app.get(WooHelperService);
    const migration = server.app.get(WooImportService);
    const user = await db.rawConnection
        .getRepository(User)
        .findOneOrFail({ where: { identifier: 'superadmin' }, relations: { roles: { channels: true } } });
    const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
    const products: WooRecord[] = Array.from({ length: 500 }, (_, index) => ({
        id: index + 1,
        name: `Synthetic benchmark ${index + 1}`,
        slug: `benchmark-${index + 1}`,
        type: 'simple',
        status: 'publish',
        price: '500.00',
        regular_price: '500.00',
        manage_stock: true,
        stock_quantity: 100000,
        stock_status: 'instock',
        tax_status: 'none',
        categories: [],
        images: [],
    }));
    products[499] = {
        ...products[499],
        type: 'variable',
        manage_stock: false,
        attributes: [
            { id: 0, name: 'Size', variation: true, options: Array.from({ length: 201 }, (_, i) => `S${i}`) },
        ],
        _variations: Array.from({ length: 201 }, (_, i) => ({
            id: 500000 + i,
            status: 'publish',
            price: '500.00',
            regular_price: '500.00',
            manage_stock: true,
            stock_quantity: 20,
            attributes: [{ id: 0, name: 'Size', option: `S${i}` }],
        })),
    };
    const address = {
        first_name: 'Synthetic',
        last_name: 'Buyer',
        address_1: 'House 12 Road 5',
        city: 'Dhanmondi',
        state: 'BD-13',
        country: 'BD',
        phone: '01712345678',
    };
    const orders: WooRecord[] = Array.from({ length: 20000 }, (_, i) => ({
        id: i + 1,
        number: String(1000 + i),
        status: 'completed',
        currency: 'BDT',
        total: '500.00',
        discount_total: '0.00',
        total_tax: '0.00',
        shipping_total: '0.00',
        customer_id: 1,
        billing: address,
        shipping: address,
        date_created_gmt: '2026-10-01T12:00:00',
        line_items: [
            { id: i + 1, product_id: (i % 499) + 1, quantity: 1, total: '500.00', name: 'Synthetic product' },
        ],
        _notes: [{ id: i + 1, note: 'Synthetic historical note' }],
        _refunds: [],
    }));
    const settings = {
        id: 1,
        currency: 'BDT',
        pricesIncludeTax: true,
        taxesEnabled: false,
        weightUnit: 'kg',
        redirects: [],
    };
    const rows: Record<string, WooRecord[]> = {
        categories: [],
        tags: [],
        products,
        customers: [
            {
                id: 1,
                email: 'benchmark@example.com',
                first_name: 'Synthetic',
                billing: address,
                shipping: address,
            },
        ],
        orders,
        coupons: [],
        reviews: [],
        settings: [settings],
    };
    const started = performance.now();
    const details = await helper.createPairing(ctx, { url: 'https://benchmark.example' });
    const pairing = JSON.parse(details.pairing);
    const session = await helper.pair(pairing.code, 'https://benchmark.example');
    let sequence = 0;
    const upload = async (kind: string, records: WooRecord[], extra: Record<string, unknown> = {}) => {
        const body = { sequence, kind, payload: JSON.stringify({ records, ...extra }) };
        const time = String(Math.floor(Date.now() / 1000));
        const nonce = randomBytes(16).toString('hex');
        await helper.accept(
            Number(session.id),
            body,
            time,
            nonce,
            chunkSignature(session.token, time, nonce, body),
        );
        sequence++;
    };
    for (const kind of HELPER_STAGES)
        for (let offset = 0; offset < rows[kind].length; offset += 100)
            await upload(kind, rows[kind].slice(offset, offset + 100));
    await upload('finish', [], {
        manifest: {
            ...settings,
            counts: Object.fromEntries(HELPER_STAGES.map(kind => [kind, rows[kind].length])),
        },
    });
    const dry = await migration.start(ctx, Number(details.sourceId), 'dryRun');
    await migration.process(Number(dry.id), ctx);
    const run = await migration.start(ctx, Number(details.sourceId), 'import', true);
    await migration.process(Number(run.id), ctx);
    const result = await db.rawConnection.getRepository(WooRun).findOneByOrFail({ id: run.id });
    const seconds = (performance.now() - started) / 1000;
    console.log(
        JSON.stringify({
            benchmark: 'M5 local synthetic; no network/image downloads',
            products: 500,
            variations: 201,
            orders: 20000,
            seconds,
            counts: result.counts,
            matches: result.verification.matches,
            status: result.status,
        }),
    );
    expect(result.status).toBe('completed');
    expect(result.verification.matches).toBe(true);
    expect(result.counts.orders).toBe(20000);
    expect(seconds).toBeLessThan(3600);
});

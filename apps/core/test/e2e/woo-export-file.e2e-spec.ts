import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import {
    Customer,
    Product,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMigrationOnlyObjects, createTestConfig, testInitialData } from '../support/test-config';
import { EXPORT_FORMAT, HELPER_STAGES, WooHelperService } from '../../src/plugins/woo-import/helper.service';
import { WooImportService } from '../../src/plugins/woo-import/woo-import.service';
import { WooRun } from '../../src/plugins/woo-import/entities';
import { WooChunk, WooPairing } from '../../src/plugins/woo-import/helper-entities';
import { WooRecord } from '../../src/plugins/woo-import/helpers';

// The WordPress helper's "Export to a file" (plugin 0.3.0): the file holds the same chunks as the
// signed upload, and the admin imports it with importWooFile. These tests build such a file from
// the synthetic fixture, import it through the Admin API, then dry-run and import it.
registerInitializer('postgres', new PostgresInitializer());
const PORT = 3089;
const KEY = `v1:${Buffer.alloc(32, 9).toString('base64')}`;
const { server, adminClient } = createTestEnvironment(
    createTestConfig(PORT, {}, { wooImportKeys: KEY, wooPublicUrl: 'https://destination.fixture.test' }),
);
const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fixtures/woo/wordpress-export.json'), 'utf8'),
) as Record<string, WooRecord[]>;
// Only open orders from the last 14 days can become live orders (see woo-migration.e2e-spec.ts).
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 19);
for (const order of fixture.orders)
    if (['pending', 'processing', 'on-hold'].includes(order.status)) {
        order.date_created_gmt = yesterday;
        order.date_modified_gmt = yesterday;
    }

// A real store's order-number plugin had reached 1,001,102: new orders must continue after it.
fixture.orders[fixture.orders.length - 1].number = '1001102';

const IMPORT_FILE = gql`
    mutation ImportWooFile($input: [WooFileInput!]!) {
        importWooFile(input: $input)
    }
`;

/** The lines the helper writes: a header, one chunk per stage, then "finish". */
function exportLines(sourceUrl = 'https://old.fixture.test', options: { finish?: boolean } = {}) {
    const lines = [JSON.stringify({ format: EXPORT_FORMAT, version: 1, plugin: '0.3.0', sourceUrl })];
    let sequence = 0;
    for (const kind of HELPER_STAGES)
        lines.push(
            JSON.stringify({
                sequence: sequence++,
                kind,
                payload: JSON.stringify({ records: fixture[kind] }),
            }),
        );
    if (options.finish !== false)
        lines.push(
            JSON.stringify({
                sequence,
                kind: 'finish',
                payload: JSON.stringify({
                    records: [],
                    manifest: {
                        ...fixture.settings[0],
                        counts: Object.fromEntries(HELPER_STAGES.map(kind => [kind, fixture[kind].length])),
                    },
                }),
            }),
        );
    return lines;
}

let ctx: RequestContext;
let helper: WooHelperService;
let migration: WooImportService;
let db: TransactionalConnection;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'woo-export-'));
const fromLines = (lines: string[]) => Readable.from([Buffer.from(lines.join('\n') + '\n')]);

describe('WooCommerce export file (WordPress helper "Export to a file")', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
        await addMigrationOnlyObjects(server);
        db = server.app.get(TransactionalConnection);
        helper = server.app.get(WooHelperService);
        migration = server.app.get(WooImportService);
        // process() is called directly below, so the worker must not race it.
        await migration['queue'].stop();
        const user = await db.rawConnection
            .getRepository(User)
            .findOneOrFail({ where: { identifier: 'superadmin' }, relations: { roles: { channels: true } } });
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
    }, 120000);
    afterAll(async () => {
        await server.destroy();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('imports a gzipped export file through the Admin API, then dry-runs and imports it', async () => {
        const file = path.join(tmp, 'ecommbd-export.jsonl.gz');
        fs.writeFileSync(file, gzipSync(exportLines().join('\n') + '\n'));
        const { importWooFile } = await adminClient.fileUploadMutation({
            mutation: IMPORT_FILE,
            filePaths: [file],
            mapVariables: () => ({ input: [{ file: null }] }),
        });
        expect(importWooFile.counts.products).toBe(fixture.products.length);
        expect(importWooFile.counts.customers).toBe(fixture.customers.length);

        const sourceId = Number(importWooFile.sourceId);
        const run = async (mode: string) => {
            const created = await migration.start(ctx, sourceId, mode, true);
            await migration.process(Number(created.id), ctx);
            return db.rawConnection.getRepository(WooRun).findOneByOrFail({ id: created.id });
        };
        expect((await run('dryRun')).status).toBe('completed');
        expect((await run('import')).status).toBe('completed');
        expect(await db.rawConnection.getRepository(Product).count()).toBe(fixture.products.length);
        expect(await db.rawConnection.getRepository(Customer).count()).toBe(fixture.customers.length);
        // The next new order is numbered after the highest WooCommerce number, in one step.
        const [next] = await db.rawConnection.query("SELECT nextval('bd_order_number_seq')::text AS number");
        expect(next.number).toBe('1001103');
    });

    it('accepts a plain (not gzipped) file and an http address of the old site', async () => {
        const result = await helper.importFile(ctx, fromLines(exportLines('http://plain.fixture.test')));
        expect(result.counts.orders).toBe(fixture.orders.length);
    });

    it('refuses a file that is not an export, or that stops early, and leaves nothing behind', async () => {
        const before = await db.rawConnection.getRepository(WooPairing).count();
        await expect(
            helper.importFile(ctx, fromLines(['{"format":"something-else","version":1}'])),
        ).rejects.toThrow('error.woo-import.fileFormat');
        await expect(helper.importFile(ctx, fromLines(['not json']))).rejects.toThrow(
            'error.woo-import.fileFormat',
        );
        await expect(
            helper.importFile(ctx, fromLines(exportLines('https://short.fixture.test', { finish: false }))),
        ).rejects.toThrow('error.woo-import.fileIncomplete');
        expect(await db.rawConnection.getRepository(WooPairing).count()).toBe(before);
    });

    it('names the line that fails the upload checks (wrong count, wrong order)', async () => {
        const lines = exportLines('https://counts.fixture.test');
        const finish = JSON.parse(lines[lines.length - 1]);
        const payload = JSON.parse(finish.payload);
        payload.manifest.counts.products += 1;
        lines[lines.length - 1] = JSON.stringify({ ...finish, payload: JSON.stringify(payload) });
        await expect(helper.importFile(ctx, fromLines(lines))).rejects.toMatchObject({
            message: 'error.woo-import.fileLine',
            variables: { line: lines.length },
        });
        const swapped = exportLines('https://order.fixture.test');
        [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
        await expect(helper.importFile(ctx, fromLines(swapped))).rejects.toMatchObject({
            variables: { line: 2 },
        });
    });

    it('gives the file no upload token, so the public upload route can never add to it', async () => {
        const result = await helper.importFile(ctx, fromLines(exportLines('https://token.fixture.test')));
        const pairing = await db.rawConnection
            .getRepository(WooPairing)
            .createQueryBuilder('p')
            .addSelect('p.token')
            .innerJoin('woo_source', 's', 's.id = p."sourceId"')
            .where('s.id = :id', { id: result.sourceId })
            .getOneOrFail();
        expect(pairing.token).toBeNull();
        expect(pairing.finished).toBe(true);
        const response = await fetch(`http://localhost:${PORT}/woo-migrate/upload/${pairing.id}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-woo-time': String(Math.floor(Date.now() / 1000)),
                'x-woo-nonce': '0'.repeat(32),
                'x-woo-signature': '0'.repeat(64),
            },
            body: JSON.stringify({ sequence: 99, kind: 'settings', payload: '{"records":[]}' }),
        });
        expect(response.status).toBe(400);
        expect(
            await db.rawConnection.getRepository(WooChunk).countBy({ pairingId: Number(pairing.id) }),
        ).toBe(HELPER_STAGES.length + 1);
    });
});

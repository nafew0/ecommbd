import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import {
    Customer,
    DefaultSearchPlugin,
    EventBus,
    NativeAuthenticationMethod,
    Order,
    OrderPlacedEvent,
    Payment,
    Product,
    ProductVariant,
    Promotion,
    RequestContext,
    RequestContextService,
    StockLevel,
    TransactionalConnection,
    User,
    UserService,
    ChannelService,
} from '@vendure/core';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { encryptSecret, parseKeyring } from '@ecommbd/shared';
import fs from 'node:fs';
import path from 'node:path';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMigrationOnlyObjects, createTestConfig, testInitialData } from '../support/test-config';
import { WooImportService } from '../../src/plugins/woo-import/woo-import.service';
import { WooRestConnector } from '../../src/plugins/woo-import/rest-connector';
import { WooHelperService, chunkSignature, HELPER_STAGES } from '../../src/plugins/woo-import/helper.service';
import { WooRedirectService } from '../../src/plugins/woo-import/redirect.service';
import { WooOpenOrderService } from '../../src/plugins/woo-import/open-order.service';
import { LegacyOrder, WooIssue, WooRun, WooSource } from '../../src/plugins/woo-import/entities';
import { WooChunk, WooExtra, WooLegacyAuth, WooPairing } from '../../src/plugins/woo-import/helper-entities';
import { WooRecord } from '../../src/plugins/woo-import/helpers';
import { ImportMapperService } from '../../src/plugins/woo-import/import-mapper.service';
import { WooExtrasService } from '../../src/plugins/woo-import/extras.service';

registerInitializer('postgres', new PostgresInitializer());
const PORT = 3073;
const BASE = `http://localhost:${PORT}`;
const KEY = `v1:${Buffer.alloc(32, 7).toString('base64')}`;
const config = createTestConfig(
    PORT,
    {},
    { wooImportKeys: KEY, wooPublicUrl: 'https://destination.fixture.test' },
);
config.plugins.push(DefaultSearchPlugin.init({ bufferUpdates: true }));
const { server, adminClient, shopClient } = createTestEnvironment(config);
const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fixtures/woo/wordpress-export.json'), 'utf8'),
) as Record<string, WooRecord[]>;
let db: TransactionalConnection,
    ctx: RequestContext,
    migration: WooImportService,
    helper: WooHelperService,
    sourceId: number;
let session: { id: number; token: string };
let sequence = 0;
let placements = 0;
let diagnostic: unknown;
const raw = () => db.rawConnection;
async function run(mode = 'import') {
    const created = await migration.start(ctx, sourceId, mode, true);
    diagnostic = undefined;
    try {
        await migration.process(Number(created.id), ctx);
    } catch (error) {
        throw diagnostic ?? error;
    }
    return raw().getRepository(WooRun).findOneByOrFail({ id: created.id });
}
async function post(endpoint: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(BASE + endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}
async function upload(
    kind: string,
    records: WooRecord[],
    extra: Record<string, unknown> = {},
    options: { sequence?: number; nonce?: string; time?: string; signature?: string } = {},
) {
    const body = {
        sequence: options.sequence ?? sequence,
        kind,
        payload: JSON.stringify({ records, ...extra }),
    };
    const time = options.time ?? String(Math.floor(Date.now() / 1000));
    const nonce = options.nonce ?? randomBytes(16).toString('hex');
    return post(`/woo-migrate/upload/${session.id}`, body, {
        'x-woo-time': time,
        'x-woo-nonce': nonce,
        'x-woo-signature': options.signature ?? chunkSignature(session.token, time, nonce, body),
    });
}
async function freshPairing() {
    const details = await helper.createPairing(ctx, { url: 'https://woo.fixture.test' });
    sourceId = Number(details.sourceId);
    const pair = JSON.parse(details.pairing);
    const response = await post('/woo-migrate/pair', {
        code: pair.code,
        sourceUrl: 'https://woo.fixture.test',
    });
    expect(response.status).toBe(201);
    session = response.body;
    sequence = 0;
    return pair;
}
async function completeUpload(records = fixture) {
    for (const kind of HELPER_STAGES) {
        const data = structuredClone(records[kind]);
        if (kind === 'customers') {
            const hash = execFileSync(
                'php',
                [
                    '-r',
                    'echo "$"."wp".password_hash(base64_encode(hash_hmac("sha384",$argv[1],"wp-sha384",true)),PASSWORD_BCRYPT,["cost"=>10]);',
                    'Synthetic-password-2026!',
                ],
                { encoding: 'utf8' },
            );
            data.forEach(row => {
                row._password_hash = hash;
                row._role = 'customer';
            });
        }
        const response = await upload(kind, data);
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        sequence++;
    }
    const response = await upload('finish', [], {
        manifest: {
            ...fixture.settings[0],
            _password_hash: 'DO_NOT_RETURN_THIS_FIELD',
            counts: Object.fromEntries(HELPER_STAGES.map(kind => [kind, records[kind].length])),
        },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    sequence++;
}

describe('M5 WooCommerce phases 21 and 22', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
        await addMigrationOnlyObjects(server);
        db = server.app.get(TransactionalConnection);
        migration = server.app.get(WooImportService);
        // These scenarios call process() directly to inspect saved leases. The real worker is
        // exercised in browser tests; prevent it racing this deliberate manual processor.
        await migration['queue'].stop();
        helper = server.app.get(WooHelperService);
        for (const service of [server.app.get(ImportMapperService), server.app.get(WooExtrasService)]) {
            const finalize = service.finalize.bind(service);
            vi.spyOn(service, 'finalize').mockImplementation(async (...args: unknown[]) => {
                try {
                    return await finalize(args[0] as RequestContext, args[1] as WooSource, args[2] as WooRun);
                } catch (error) {
                    diagnostic = error;
                    throw error;
                }
            });
        }
        const user = await raw()
            .getRepository(User)
            .findOneOrFail({ where: { identifier: 'superadmin' }, relations: { roles: { channels: true } } });
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
        server.app
            .get(EventBus)
            .ofType(OrderPlacedEvent)
            .subscribe(() => placements++);
        vi.spyOn(WooRestConnector.prototype, 'inspectSettings').mockResolvedValue(
            fixture.settings[0] as never,
        );
        vi.spyOn(WooRestConnector.prototype, 'page').mockImplementation(async (kind, offset, size) => ({
            records: structuredClone((fixture[kind] ?? []).slice(offset, offset + size)),
            size,
            total: (fixture[kind] ?? []).length,
        }));
        vi.spyOn(WooRestConnector.prototype, 'children').mockImplementation(async endpoint => {
            const [kind, id, child] = endpoint.split('/');
            const row = fixture[kind].find(r => r.id === Number(id));
            return structuredClone(
                row?.[child === 'variations' ? '_variations' : child === 'notes' ? '_notes' : '_refunds'] ??
                    [],
            );
        });
    }, 120000);
    afterAll(async () => {
        vi.restoreAllMocks();
        await server.destroy();
    });
    it('REST dry run writes no commerce data, then imports catalog/history exactly without placement', async () => {
        const source = await migration.connect(ctx, {
            url: 'https://woo.fixture.test',
            key: 'ck_' + 'a'.repeat(40),
            secret: 'cs_' + 'b'.repeat(40),
            imageHosts: [],
            pricesIncludeTax: false,
            weightUnit: 'kg',
        });
        sourceId = Number(source.id);
        const dry = await run('dryRun');
        expect(dry.status).toBe('completed');
        expect(await raw().getRepository(Product).count()).toBe(0);
        expect(await raw().getRepository(Customer).count()).toBe(0);
        const imported = await run();
        const issues = await raw()
            .getRepository(WooIssue)
            .findBy({ runId: Number(imported.id) });
        expect(imported.status, JSON.stringify(issues)).toBe('completed');
        expect(imported.verification.matches).toBe(true);
        expect(await raw().getRepository(Product).count()).toBe(2);
        expect(await raw().getRepository(ProductVariant).count()).toBe(5);
        expect(await raw().getRepository(LegacyOrder).count()).toBe(2);
        expect(await raw().getRepository(Order).count()).toBe(0);
        expect(await raw().getRepository(Payment).count()).toBe(0);
        expect(placements).toBe(0);
        expect(
            Number((await raw().query('SELECT count(*)::int AS count FROM bd_sms_message'))[0].count),
        ).toBe(0);
        const historical = await raw().getRepository(LegacyOrder).findOneByOrFail({ total: '299925' });
        expect(historical.refunded).toBe('12525');
        expect(historical.snapshot._notes).toBeDefined();
    });
    it('repeats REST import without duplicates and resumes an expired lease', async () => {
        const before = await raw().getRepository(StockLevel).find();
        const repeated = await run();
        expect(repeated.status).toBe('completed');
        expect(repeated.counts.unchanged).toBe(8);
        expect((await raw().getRepository(StockLevel).find()).map(s => s.stockOnHand)).toEqual(
            before.map(s => s.stockOnHand),
        );
        const interrupted = await migration.start(ctx, sourceId, 'import', true);
        await raw()
            .getRepository(WooRun)
            .update(interrupted.id, {
                status: 'running',
                leaseOwner: 'dead-worker',
                leaseUntil: new Date(0),
            });
        await migration.resume(ctx, Number(interrupted.id));
        await migration.process(Number(interrupted.id), ctx);
        expect((await migration.run(ctx, Number(interrupted.id))).status).toBe('completed');
    });
    it('pairs once, refuses altered/stale/out-of-order chunks, and accepts idempotent retries', async () => {
        const pairing = await freshPairing();
        expect(
            (await post('/woo-migrate/pair', { code: pairing.code, sourceUrl: 'https://woo.fixture.test' }))
                .status,
        ).toBe(400);
        expect((await upload('categories', [], {}, { signature: '0'.repeat(64) })).status).toBe(400);
        expect((await upload('categories', [], {}, { time: '1000000000' })).status).toBe(400);
        expect((await upload('categories', [], {}, { sequence: 1 })).status).toBe(400);
        const accepted = await upload('categories', fixture.categories);
        expect(accepted.status).toBe(201);
        expect((await upload('categories', fixture.categories)).status).toBe(201);
        expect((await upload('categories', [])).status).toBe(400);
        // Continue with a fresh complete upload; pairing again reuses the same source/mappings.
        await freshPairing();
        await completeUpload();
        const secret = await raw()
            .getRepository(WooChunk)
            .createQueryBuilder('c')
            .addSelect('c.payload')
            .getOneOrFail();
        expect(secret.payload).not.toContain('Synthetic-password');
        expect(secret.payload).not.toContain('_password_hash');
        await expect(run()).rejects.toThrow(); // A previous snapshot's dry run cannot approve this upload.
        expect((await run('dryRun')).status).toBe('completed');
        const imported = await run();
        const issues = await raw()
            .getRepository(WooIssue)
            .findBy({ runId: Number(imported.id) });
        expect(imported.status, JSON.stringify(issues)).toBe('completed');
        expect(imported.verification.matches).toBe(true);
        expect(await raw().getRepository(Customer).count()).toBe(1);
        expect(await raw().getRepository(Product).count()).toBe(2);
        expect(await raw().getRepository(WooLegacyAuth).count()).toBe(1);
        expect(await raw().getRepository(Promotion).countBy({ couponCode: 'synthetic10' })).toBe(1);
        expect(await raw().getRepository(WooExtra).countBy({ kind: 'reviews' })).toBe(1);
        expect(JSON.stringify(await migration.sources(ctx))).not.toContain('DO_NOT_RETURN_THIS_FIELD');
        await expect(migration.start(ctx, sourceId, 'catchUp', true)).rejects.toThrow(
            'error.woo-import.freshUpload',
        );
    });
    it('authenticates the old WordPress password once, replaces it natively and deletes the secret', async () => {
        const customer = await raw()
            .getRepository(Customer)
            .findOneOrFail({
                where: { emailAddress: fixture.customers[0].email },
                relations: { user: true },
            });
        expect(await shopClient.asUserWithCredentials(customer.emailAddress, 'wrong')).toMatchObject({
            errorCode: 'INVALID_CREDENTIALS_ERROR',
        });
        const source = await migration.source(ctx, sourceId);
        const latestRun = await raw()
            .getRepository(WooRun)
            .findOneOrFail({ where: { sourceId }, order: { id: 'DESC' } });
        await server.app.get(WooExtrasService).apply(ctx, source, latestRun, 'customers', {
            ...fixture.customers[0],
            _role: 'customer',
            _password_hash: createHash('md5').update('Updated-synthetic-2026!').digest('hex'),
        });
        expect(
            await shopClient.asUserWithCredentials(customer.emailAddress, 'Synthetic-password-2026!'),
        ).toMatchObject({ errorCode: 'INVALID_CREDENTIALS_ERROR' });
        await shopClient.asUserWithCredentials(customer.emailAddress, 'Updated-synthetic-2026!');
        const native = await raw()
            .getRepository(NativeAuthenticationMethod)
            .createQueryBuilder('n')
            .addSelect('n.passwordHash')
            .where('n.identifier=:email', { email: customer.emailAddress })
            .getOneOrFail();
        expect(native.passwordHash.startsWith('$2')).toBe(true);
        expect(await raw().getRepository(WooLegacyAuth).count()).toBe(0);
        await run();
        expect(await raw().getRepository(WooLegacyAuth).count()).toBe(0);
        expect(
            await shopClient.asUserWithCredentials(customer.emailAddress, 'Synthetic-password-2026!'),
        ).toMatchObject({ errorCode: 'INVALID_CREDENTIALS_ERROR' });
    });
    it('resolves custom bases and query selectors to final canonical paths and prevents loops', async () => {
        const redirects = server.app.get(WooRedirectService);
        const product = fixture.products[0];
        expect(await redirects.resolve(ctx, `/item/${product.slug}/`)).toEqual({
            status: 301,
            target: `/product/${product.slug}/`,
        });
        expect(await redirects.resolve(ctx, `/?p=${product.id}`)).toEqual({
            status: 301,
            target: `/product/${product.slug}/`,
        });
        await redirects.save(ctx, sourceId, '/old/', '/middle/');
        await redirects.save(ctx, sourceId, '/middle/', '/final/');
        expect(await redirects.resolve(ctx, '/old/')).toEqual({ status: 301, target: '/final/' });
        await expect(redirects.save(ctx, sourceId, '/final/', '/old/')).rejects.toThrow();
        await expect(redirects.save(ctx, sourceId, '/attack/', '//evil.test/')).rejects.toThrow();
        await redirects.resolve(ctx, '/unresolved/', true);
        expect((await redirects.list(ctx, sourceId)).misses.some(m => m.path === '/unresolved/')).toBe(true);
    });
    it('refuses unauthenticated admin access and converts a reviewed COD order only once', async () => {
        const denied = await post('/admin-api', { query: '{wooSources}' });
        expect(denied.body.errors[0].extensions.code).toBe('FORBIDDEN');
        const legacy = await raw().getRepository(LegacyOrder).findOneByOrFail({ status: 'processing' });
        const convert = server.app.get(WooOpenOrderService);
        await expect(
            convert.convert(ctx, Number(legacy.id), { sourceFrozen: false, inventoryAlreadyReduced: true }),
        ).rejects.toThrow();
        const first = await convert.convert(ctx, Number(legacy.id), {
            sourceFrozen: true,
            inventoryAlreadyReduced: true,
        });
        expect(first?.state).toBe('PaymentAuthorized');
        const second = await convert.convert(ctx, Number(legacy.id), {
            sourceFrozen: true,
            inventoryAlreadyReduced: true,
        });
        expect(second?.id).toBe(first?.id);
        expect(await raw().getRepository(Order).count()).toBe(1);
        const exported = await adminClient.query<{
            wooRollbackOrders: { totalItems: number; items: Array<{ number: string; payments: unknown[] }> };
        }>(
            gql`
                query ($since: DateTime!) {
                    wooRollbackOrders(since: $since)
                }
            `,
            { since: new Date(Date.now() - 86400_000).toISOString() },
        );
        expect(exported.wooRollbackOrders.totalItems).toBe(1);
        expect(exported.wooRollbackOrders.items[0].number).toBe(legacy.number);
        expect(JSON.stringify(exported)).not.toContain('passwordHash');
    });
    it('revokes helper tokens and removes uploaded credential-bearing chunks on completion', async () => {
        await helper.revoke(ctx, sourceId);
        expect((await upload('settings', [])).status).toBe(400);
        await migration.complete(ctx, sourceId);
        expect(await raw().getRepository(WooChunk).count()).toBe(0);
        expect((await raw().getRepository(WooSource).findOneByOrFail({ id: sourceId })).completed).toBe(true);
    });
    it('enforces pairing expiry, token expiry and cleans obsolete uploads', async () => {
        await freshPairing();
        await raw()
            .getRepository(WooPairing)
            .update(session.id, { tokenExpiresAt: new Date(0) });
        expect((await upload('settings', [])).status).toBe(400);
        const created = await helper.createPairing(ctx, { url: 'https://expired.fixture.test' });
        const details = JSON.parse(created.pairing);
        const id = Number(details.code.split('.')[0]);
        await raw()
            .getRepository(WooPairing)
            .update(id, { expiresAt: new Date(0) });
        expect(
            (
                await post('/woo-migrate/pair', {
                    code: details.code,
                    sourceUrl: 'https://expired.fixture.test',
                })
            ).status,
        ).toBe(400);
        await helper.cleanup();
        expect(await raw().getRepository(WooPairing).findOneBy({ id: session.id })).toBeNull();
    });
    it('expires unused legacy hashes and a native password reset cannot reactivate the old password', async () => {
        const users = server.app.get(UserService);
        const email = 'reset-synthetic@example.com';
        const user = await users.createCustomerUser(ctx, email, 'Temporary-synthetic-2026!');
        if (!('id' in user)) throw new Error('USER_CREATE_FAILED');
        await raw().getRepository(User).update(user.id, { verified: true });
        const customer = new Customer({
            firstName: 'Synthetic',
            lastName: 'Reset',
            emailAddress: email,
            user,
            customFields: { phone: '+8801912345678', source: 'import' },
        });
        await server.app.get(ChannelService).assignToCurrentChannel(customer, ctx);
        await raw().getRepository(Customer).save(customer);
        const reference = randomBytes(32).toString('hex');
        await raw()
            .getRepository(NativeAuthenticationMethod)
            .update({ user: { id: user.id } }, { passwordHash: `woo:${reference}` });
        const legacy = await raw()
            .getRepository(WooLegacyAuth)
            .save(
                new WooLegacyAuth({
                    reference,
                    customerId: Number(customer.id),
                    sourceId,
                    secret: encryptSecret(
                        createHash('md5').update('Old-synthetic-2026!').digest('hex'),
                        parseKeyring(KEY),
                        `woo-password:${customer.id}`,
                    ),
                    expiresAt: new Date(0),
                }),
            );
        expect(await shopClient.asUserWithCredentials(email, 'Old-synthetic-2026!')).toMatchObject({
            errorCode: 'INVALID_CREDENTIALS_ERROR',
        });
        await raw()
            .getRepository(WooLegacyAuth)
            .update(legacy.id, { expiresAt: new Date(Date.now() + 86400_000) });
        const shopCtx = await server.app.get(RequestContextService).create({ apiType: 'shop' });
        await users.setPasswordResetToken(shopCtx, email);
        const native = await raw()
            .getRepository(NativeAuthenticationMethod)
            .findOneByOrFail({ identifier: email });
        expect(native.passwordResetToken).toBeTruthy();
        const reset = await users.resetPasswordByToken(
            shopCtx,
            native.passwordResetToken!,
            'New-synthetic-2026!',
        );
        expect('id' in reset).toBe(true);
        expect(await shopClient.asUserWithCredentials(email, 'Old-synthetic-2026!')).toMatchObject({
            errorCode: 'INVALID_CREDENTIALS_ERROR',
        });
        await shopClient.asUserWithCredentials(email, 'New-synthetic-2026!');
        await helper.cleanup();
        expect(await raw().getRepository(WooLegacyAuth).findOneBy({ id: legacy.id })).toBeNull();
    });
    it('applies a supported imported coupon and refuses unsupported restrictions', async () => {
        await shopClient.asAnonymousUser();
        const variant = await raw()
            .getRepository(ProductVariant)
            .findOneByOrFail({ sku: 'SYNTHETIC-' + fixture.products[0].id });
        await shopClient.query(
            gql`
                mutation ($id: ID!) {
                    addItemToOrder(productVariantId: $id, quantity: 1) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            { id: variant.id },
        );
        const result = await shopClient.query<{ applyCouponCode: { subTotalWithTax: number } }>(gql`
            mutation {
                applyCouponCode(couponCode: "synthetic10") {
                    ... on Order {
                        subTotalWithTax
                    }
                }
            }
        `);
        expect(result.applyCouponCode.subTotalWithTax).toBe(135000);
        const source = await migration.source(ctx, sourceId);
        const latestRun = await raw()
            .getRepository(WooRun)
            .findOneOrFail({ where: { sourceId }, order: { id: 'DESC' } });
        await server.app.get(WooExtrasService).apply(ctx, source, latestRun, 'coupons', {
            ...fixture.coupons[0],
            id: 999,
            free_shipping: true,
        });
        expect(await raw().getRepository(Promotion).countBy({ couponCode: 'synthetic10' })).toBe(1);
        expect(
            await raw()
                .getRepository(WooIssue)
                .exists({
                    where: { runId: Number(latestRun.id), code: 'COUPON_CONSTRAINT_REQUIRES_REVIEW' },
                }),
        ).toBe(true);
        // A formerly supported coupon must not stay live after source restrictions change.
        await server.app.get(WooExtrasService).apply(ctx, source, latestRun, 'coupons', {
            ...fixture.coupons[0],
            free_shipping: true,
        });
        expect(
            await raw().getRepository(Promotion).findOneByOrFail({ couponCode: 'synthetic10' }),
        ).toMatchObject({ enabled: false });
    });
});

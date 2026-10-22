import { decryptSecret, encryptSecret, parseKeyring, type Keyring, dhakaParts } from '@ecommbd/shared';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
    Asset,
    EventBus,
    JobQueue,
    JobQueueService,
    RequestContext,
    SearchService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In, IsNull } from 'typeorm';
import { z } from 'zod';
import { LegacyOrder, WooIssue, WooMapping, WooRun, WooSource } from './entities';
import { arrays, digest, gmt, minor, text, WooRecord } from './helpers';
import { ImportMapperService } from './import-mapper.service';
import { REST_STAGES, WooRestConnector, SourceConnector } from './rest-connector';
import { WooHelperService } from './helper.service';
import { WooExtrasService } from './extras.service';
import { WooChunk, WooPairing } from './helper-entities';
import { markWooImportContext, WooImportCompletedEvent } from './context';

import { WOO_OPTIONS, WooImportOptions } from './options';
export { WOO_OPTIONS, WooImportOptions } from './options';
const sourceInput = z.object({
    url: z
        .url()
        .max(500)
        .refine(v => {
            const u = new URL(v);
            return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
        }),
    key: z.string().regex(/^ck_[a-f0-9]+$/),
    secret: z.string().regex(/^cs_[a-f0-9]+$/),
    imageHosts: z
        .array(
            z
                .string()
                .max(253)
                .regex(/^[a-z0-9.-]+$/),
        )
        .max(20),
    pricesIncludeTax: z.boolean(),
    weightUnit: z.enum(['kg', 'g', 'lbs', 'oz']),
});
const safeError = (error: unknown) =>
    error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)
        ? error.message
        : 'IMPORT_RECORD_FAILED';

/** Upstream/SQL errors can contain personal data. Keep a safe cause code in worker failures. */
class MigrationFailure extends Error {
    readonly cause: string;
    constructor(error: unknown, code = safeError(error)) {
        super(code);
        this.cause = safeError(error);
    }
}

@Injectable()
export class WooImportService implements OnModuleInit {
    private queue: JobQueue<{ runId: number; ctx: ReturnType<RequestContext['serialize']> }>;
    private keyring?: Keyring;
    constructor(
        private connection: TransactionalConnection,
        private jobs: JobQueueService,
        private mapper: ImportMapperService,
        private search: SearchService,
        private events: EventBus,
        private helper: WooHelperService,
        private extras: WooExtrasService,
        @Inject(WOO_OPTIONS) options: WooImportOptions,
    ) {
        if (options.encryptionKeys) this.keyring = parseKeyring(options.encryptionKeys);
    }
    async onModuleInit() {
        this.queue = await this.jobs.createQueue({
            name: 'woo-import',
            process: async job => this.process(job.data.runId, RequestContext.deserialize(job.data.ctx)),
        });
    }
    private keys() {
        if (!this.keyring) throw new UserInputError('error.woo-import.encryption');
        return this.keyring;
    }
    private sourceDto(s: WooSource) {
        return {
            id: s.id,
            url: s.url,
            imageHosts: s.imageHosts,
            settings: s.settings,
            lastSyncedAt: s.lastSyncedAt,
            completed: s.completed,
        };
    }
    async source(ctx: RequestContext, id: number, secrets = false) {
        const qb = this.connection
            .getRepository(ctx, WooSource)
            .createQueryBuilder('s')
            .where('s.id = :id AND s.channelId = :channelId', { id, channelId: ctx.channelId });
        if (secrets) qb.addSelect('s.credentials');
        const source = await qb.getOne();
        if (!source) throw new UserInputError('error.woo-import.notFound');
        return source;
    }
    async sources(ctx: RequestContext) {
        return (
            await this.connection
                .getRepository(ctx, WooSource)
                .find({ where: { channelId: Number(ctx.channelId) }, order: { id: 'DESC' } })
        ).map(s => this.sourceDto(s));
    }
    async connect(ctx: RequestContext, input: unknown) {
        const parsed = sourceInput.safeParse(input);
        if (!parsed.success) throw new UserInputError('error.woo-import.input');
        const value = parsed.data;
        this.keys();
        const url = value.url.replace(/\/+$/, '');
        const connector = new WooRestConnector(url, value);
        let inspection;
        try {
            const [products, orders] = await Promise.all([
                connector.page('products', 0, 1),
                connector.page('orders', 0, 1),
            ]);
            const settings = await connector.inspectSettings();
            if (!settings.currency) throw new UserInputError('error.woo-import.settings');
            inspection = { products: products.total, orders: orders.total, api: 'wc/v3', ...settings };
        } catch (error) {
            if (error instanceof UserInputError) throw error;
            throw new UserInputError('error.woo-import.connection', { reason: safeError(error) });
        } finally {
            await connector.close();
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            const repo = this.connection.getRepository(txCtx, WooSource);
            const existing = await repo.findOneBy({ channelId: Number(ctx.channelId), url });
            if (existing) await this.ensureIdle(txCtx, Number(existing.id));
            const source = await repo.save(
                new WooSource({
                    ...existing,
                    channelId: Number(ctx.channelId),
                    url,
                    credentials: encryptSecret(
                        JSON.stringify({ key: value.key, secret: value.secret }),
                        this.keys(),
                        `woo:${ctx.channelId}:${url}`,
                    ),
                    imageHosts: [...new Set([new URL(url).hostname.toLowerCase(), ...value.imageHosts])],
                    settings: {
                        ...existing?.settings,
                        pricesIncludeTax: inspection.pricesIncludeTax ?? value.pricesIncludeTax,
                        weightUnit: inspection.weightUnit ?? value.weightUnit,
                        currency: inspection.currency,
                        taxesEnabled: inspection.taxesEnabled,
                        inspection,
                    },
                    completed: false,
                }),
            );
            return this.sourceDto(source);
        });
    }
    private async connector(ctx: RequestContext, source: WooSource): Promise<SourceConnector> {
        if (source.settings.transport === 'helper') return this.helper.connector(source);
        if (!source.credentials) throw new UserInputError('error.woo-import.credentials');
        const credentials = JSON.parse(
            decryptSecret(source.credentials, this.keys(), `woo:${ctx.channelId}:${source.url}`),
        ) as { key: string; secret: string };
        return new WooRestConnector(source.url, credentials);
    }
    private async ensureIdle(ctx: RequestContext, sourceId: number) {
        await this.connection
            .getRepository(ctx, WooSource)
            .query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [2100, sourceId]);
        const active = await this.connection
            .getRepository(ctx, WooRun)
            .exists({ where: { sourceId, status: In(['queued', 'running']) } });
        if (active) throw new UserInputError('error.woo-import.busy');
    }
    async start(ctx: RequestContext, sourceId: number, mode: string, acknowledge = false) {
        if (!['dryRun', 'import', 'catchUp'].includes(mode))
            throw new UserInputError('error.woo-import.input');
        const run = await this.connection.withTransaction(ctx, async txCtx => {
            const source = await this.source(txCtx, sourceId, true);
            if ((!source.credentials && source.settings.transport !== 'helper') || source.completed)
                throw new UserInputError('error.woo-import.credentials');
            if (source.settings.transport === 'helper') await this.helper.connector(source);
            await this.ensureIdle(txCtx, sourceId);
            if (mode !== 'dryRun') {
                const dry = await this.connection.getRepository(txCtx, WooRun).findOne({
                    where: { sourceId, mode: 'dryRun', status: In(['completed', 'needsReview']) },
                    order: { id: 'DESC' },
                });
                if (!dry || !acknowledge || dry.verification.sourceRevision !== this.sourceRevision(source))
                    throw new UserInputError('error.woo-import.review');
            }
            if (mode === 'catchUp' && !source.lastSyncedAt)
                throw new UserInputError('error.woo-import.review');
            if (
                mode === 'catchUp' &&
                source.settings.transport === 'helper' &&
                source.settings.lastImportedPairingId === source.settings.helperPairingId
            )
                throw new UserInputError('error.woo-import.freshUpload');
            return this.connection.getRepository(txCtx, WooRun).save(
                new WooRun({
                    sourceId,
                    mode: mode as WooRun['mode'],
                    status: 'queued',
                    watermark: new Date(),
                    modifiedAfter:
                        mode === 'catchUp' && source.lastSyncedAt
                            ? new Date(source.lastSyncedAt.getTime() - 60_000)
                            : null,
                    cursor: { stage: 0, offset: 0, size: 100 },
                    counts: {},
                    verification: {
                        inspection: source.settings.inspection,
                        sourceRevision: this.sourceRevision(source),
                    } as never,
                }),
            );
        });
        await this.enqueue(ctx, run);
        return run;
    }
    private async enqueue(ctx: RequestContext, run: Pick<WooRun, 'id'>) {
        try {
            await this.queue.add({ runId: Number(run.id), ctx: ctx.serialize() }, { retries: 0 });
        } catch {
            await this.connection
                .getRepository(ctx, WooRun)
                .update(run.id, { status: 'failed', error: 'QUEUE_UNAVAILABLE' });
            throw new UserInputError('error.woo-import.queue');
        }
    }
    private sourceRevision(source: WooSource) {
        return digest({
            url: source.url,
            imageHosts: source.imageHosts,
            pairing: source.settings.helperPairingId,
            currency: source.settings.currency,
            tax: source.settings.pricesIncludeTax,
            weight: source.settings.weightUnit,
        });
    }
    async run(ctx: RequestContext, id: number) {
        const run = await this.connection.getRepository(ctx, WooRun).findOneBy({ id });
        if (!run) throw new UserInputError('error.woo-import.notFound');
        await this.source(ctx, run.sourceId);
        const issues = await this.connection
            .getRepository(ctx, WooIssue)
            .find({ where: { runId: id }, order: { id: 'DESC' }, take: 200 });
        return { ...run, leaseOwner: undefined, issues };
    }
    async runs(ctx: RequestContext, sourceId: number) {
        await this.source(ctx, sourceId);
        return this.connection
            .getRepository(ctx, WooRun)
            .find({ where: { sourceId }, order: { id: 'DESC' }, take: 20 });
    }
    async resume(ctx: RequestContext, id: number) {
        const run = await this.connection.withTransaction(ctx, async txCtx => {
            const found = await this.run(txCtx, id);
            await this.connection
                .getRepository(txCtx, WooRun)
                .query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [2100, found.sourceId]);
            const repo = this.connection.getRepository(txCtx, WooRun);
            const locked = await repo
                .createQueryBuilder('r')
                .setLock('pessimistic_write')
                .where('r.id = :id', { id })
                .getOneOrFail();
            if (locked.status === 'running' && locked.leaseUntil && locked.leaseUntil > new Date())
                throw new UserInputError('error.woo-import.busy');
            if (!['failed', 'queued', 'running'].includes(locked.status))
                throw new UserInputError('error.woo-import.review');
            const others = await repo
                .createQueryBuilder('r')
                .where('r.sourceId = :sourceId AND r.id != :id AND r.status IN (:...statuses)', {
                    sourceId: locked.sourceId,
                    id,
                    statuses: ['queued', 'running'],
                })
                .getCount();
            if (others) throw new UserInputError('error.woo-import.busy');
            const source = await this.source(txCtx, locked.sourceId, true);
            if (!source.credentials && source.settings.transport !== 'helper')
                throw new UserInputError('error.woo-import.credentials');
            await repo.update(id, { status: 'queued', leaseUntil: null, leaseOwner: null, error: null });
            return locked;
        });
        await this.enqueue(ctx, run);
        return this.run(ctx, id);
    }
    async complete(ctx: RequestContext, sourceId: number) {
        return this.connection.withTransaction(ctx, async txCtx => {
            await this.source(txCtx, sourceId);
            await this.ensureIdle(txCtx, sourceId);
            await this.connection
                .getRepository(txCtx, WooSource)
                .update(sourceId, { credentials: null, completed: true });
            await this.helper.revoke(txCtx, sourceId);
            const pairings = await this.connection.getRepository(txCtx, WooPairing).findBy({ sourceId });
            for (const pairing of pairings)
                await this.connection
                    .getRepository(txCtx, WooChunk)
                    .delete({ pairingId: Number(pairing.id) });
            return true;
        });
    }
    private async augment(connector: SourceConnector, kind: string, record: WooRecord) {
        if (connector.stages) return record;
        if (kind === 'products' && record.type === 'variable')
            record._variations = await connector.children(`products/${record.id}/variations`);
        if (kind === 'orders') {
            const [notes, refunds] = await Promise.all([
                connector.children(`orders/${record.id}/notes`),
                arrays(record.refunds).length
                    ? connector.children(`orders/${record.id}/refunds`)
                    : Promise.resolve([]),
            ]);
            record._notes = notes;
            record._refunds = refunds;
        }
        return record;
    }
    private totals(record: WooRecord, prior: Record<string, unknown>) {
        const date = gmt(record.date_created_gmt);
        const d = date && dhakaParts(date);
        const key = `${text(record.currency, 8)}:${d ? `${d.year}-${String(d.month).padStart(2, '0')}` : 'unknown'}`;
        const totals = { ...((prior.expectedTotals as Record<string, string>) ?? {}) };
        totals[key] = (BigInt(totals[key] ?? '0') + BigInt(minor(record.total))).toString();
        return { ...prior, expectedTotals: totals };
    }
    async process(runId: number, ctx: RequestContext) {
        markWooImportContext(ctx);
        const owner = randomUUID();
        const repo = this.connection.getRepository(ctx, WooRun);
        const claimed = await repo
            .createQueryBuilder()
            .update()
            .set({ status: 'running', leaseOwner: owner, leaseUntil: new Date(Date.now() + 300_000) })
            .where(
                'id = :id AND status IN (:...statuses) AND ("leaseUntil" IS NULL OR "leaseUntil" < :now)',
                { id: runId, statuses: ['queued', 'failed', 'running'], now: new Date() },
            )
            .execute();
        if (!claimed.affected) return { skipped: true };
        let connector: SourceConnector | undefined;
        try {
            const run = await repo.findOneByOrFail({ id: runId });
            const source = await this.source(ctx, run.sourceId, true);
            connector = await this.connector(ctx, source);
            const stages = connector.stages ?? REST_STAGES;
            while (run.cursor.stage < stages.length) {
                const kind = stages[run.cursor.stage];
                // Final catch-up is a full reconciliation. Child notes/refunds need not bump
                // parent modification dates, and a live source can change while pages are read.
                const page = await connector.page(
                    kind,
                    run.cursor.offset,
                    run.cursor.size,
                    null,
                    run.watermark,
                );
                run.cursor.size = page.size;
                if (page.total !== null)
                    run.verification.sourceCounts = {
                        ...((run.verification.sourceCounts as Record<string, number>) ?? {}),
                        [kind]: page.total,
                    };
                if (!page.records.length) {
                    const declared = (run.verification.sourceCounts as Record<string, number> | undefined)?.[
                        kind
                    ];
                    if (declared != null && (run.counts[kind] ?? 0) !== declared)
                        await this.mapper.issue(ctx, run, kind, '', 'SOURCE_COUNT_MISMATCH', 'error');
                    run.cursor = { stage: run.cursor.stage + 1, offset: 0, size: 100 };
                    const saved = await repo.update(
                        { id: run.id, leaseOwner: owner },
                        {
                            cursor: run.cursor,
                            verification: run.verification as never,
                        },
                    );
                    if (!saved.affected) throw new Error('IMPORT_LEASE_LOST');
                    continue;
                }
                for (const raw of page.records) {
                    const record = await this.augment(connector, kind, raw);
                    const checkpoint = {
                        cursor: { ...run.cursor },
                        counts: { ...run.counts },
                        verification: structuredClone(run.verification),
                    };
                    let result = 'dryRun';
                    try {
                        await this.connection.withTransaction(ctx, async txCtx => {
                            markWooImportContext(txCtx);
                            const locked = await this.connection
                                .getRepository(txCtx, WooRun)
                                .createQueryBuilder('r')
                                .setLock('pessimistic_write')
                                .where('r.id = :id', { id: run.id })
                                .getOneOrFail();
                            if (locked.leaseOwner !== owner) throw new Error('IMPORT_LEASE_LOST');
                            await this.mapper.inspectRecord(txCtx, source, run, kind, record);
                            if (run.mode !== 'dryRun')
                                result = await this.mapper.apply(txCtx, source, run, kind, record);
                            if (run.mode !== 'dryRun')
                                await this.extras.apply(txCtx, source, run, kind, record);
                            if (kind === 'orders') run.verification = this.totals(record, run.verification);
                            const samples = (run.verification.samples ?? []) as Array<
                                Record<string, unknown>
                            >;
                            if (kind === 'orders') {
                                const sample = {
                                    sourceKey: String(record.id),
                                    total: minor(record.total),
                                    currency: text(record.currency, 8),
                                    status: text(record.status, 64),
                                    number: text(record.number || String(record.id), 100),
                                    lines: digest(record.line_items),
                                    notes: digest(record._notes),
                                    refunds: digest(record._refunds),
                                };
                                const position =
                                    samples.length < 20
                                        ? samples.length
                                        : Math.floor(Math.random() * ((run.counts.orders ?? 0) + 1));
                                if (position < 20) samples[position] = sample;
                            }
                            run.verification.samples = samples;
                            run.counts[kind] = (run.counts[kind] ?? 0) + 1;
                            run.counts[result] = (run.counts[result] ?? 0) + 1;
                            run.cursor.offset++;
                            await this.connection.getRepository(txCtx, WooRun).update(run.id, {
                                cursor: run.cursor,
                                counts: run.counts,
                                verification: run.verification as never,
                                leaseUntil: new Date(Date.now() + 300_000),
                            });
                        });
                    } catch (error) {
                        if (safeError(error) === 'IMPORT_LEASE_LOST') throw error;
                        run.cursor = checkpoint.cursor;
                        run.counts = checkpoint.counts;
                        run.verification = checkpoint.verification;
                        // A refused record rolls back its entire mapping/write. Record the refusal
                        // and advance visibly; verification will never call this a clean import.
                        await this.mapper.issue(ctx, run, kind, String(record.id), safeError(error), 'error');
                        run.counts.failed = (run.counts.failed ?? 0) + 1;
                        run.counts[kind] = (run.counts[kind] ?? 0) + 1;
                        run.cursor.offset++;
                        const saved = await repo.update(
                            { id: run.id, leaseOwner: owner },
                            {
                                cursor: run.cursor,
                                counts: run.counts,
                                leaseUntil: new Date(Date.now() + 300_000),
                            },
                        );
                        if (!saved.affected) throw new MigrationFailure(error, 'IMPORT_LEASE_LOST');
                    }
                }
            }
            if (run.mode !== 'dryRun') {
                await this.connection.withTransaction(ctx, async txCtx => {
                    markWooImportContext(txCtx);
                    const locked = await this.connection
                        .getRepository(txCtx, WooRun)
                        .createQueryBuilder('r')
                        .setLock('pessimistic_write')
                        .where('r.id = :id', { id: run.id })
                        .getOneOrFail();
                    if (locked.leaseOwner !== owner) throw new Error('IMPORT_LEASE_LOST');
                    await this.mapper.finalize(txCtx, source);
                    await this.extras.finalize(txCtx, source, run);
                    await this.connection
                        .getRepository(txCtx, WooRun)
                        .update(run.id, { leaseUntil: new Date(Date.now() + 300_000) });
                });
                await this.search.reindex(ctx);
                await this.events.publish(
                    new WooImportCompletedEvent(ctx, Number(source.id), Number(run.id)),
                );
            }
            run.verification = await this.verify(ctx, source, run);
            const errors = await this.connection
                .getRepository(ctx, WooIssue)
                .countBy({ runId, severity: 'error' });
            const issues = await this.connection.getRepository(ctx, WooIssue).countBy({ runId });
            const status = errors || run.verification.matches === false ? 'needsReview' : 'completed';
            const finished = await repo.update(
                { id: run.id, leaseOwner: owner },
                {
                    status,
                    verification: { ...run.verification, issueCount: issues } as never,
                    leaseOwner: null,
                    leaseUntil: null,
                },
            );
            if (!finished.affected) throw new Error('IMPORT_LEASE_LOST');
            if (run.mode !== 'dryRun' && status === 'completed')
                await this.connection.getRepository(ctx, WooSource).update(source.id, {
                    lastSyncedAt: run.watermark,
                    ...(source.settings.transport === 'helper'
                        ? {
                              settings: {
                                  ...(await this.source(ctx, Number(source.id))).settings,
                                  lastImportedPairingId: Number(source.settings.helperPairingId),
                              },
                          }
                        : {}),
                });
            return { status, counts: run.counts };
        } catch (error) {
            await repo.update(
                { id: runId, leaseOwner: owner },
                { status: 'failed', error: safeError(error), leaseOwner: null, leaseUntil: null },
            );
            throw new MigrationFailure(error);
        } finally {
            await connector?.close();
        }
    }
    private async verify(ctx: RequestContext, source: WooSource, run: WooRun) {
        if (run.mode === 'dryRun')
            return {
                ...run.verification,
                dryRun: true,
                estimatedRecords: REST_STAGES.reduce((sum, kind) => sum + (run.counts[kind] ?? 0), 0),
                durationEstimate:
                    'Measure source latency and image processing on the rehearsal; counts alone are not a time guarantee.',
            };
        const rows = (await this.connection
            .getRepository(ctx, LegacyOrder)
            .query(
                `SELECT currency, COALESCE(to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM'), 'unknown') AS month, SUM(total::numeric)::text AS total, count(*)::int AS count FROM woo_legacy_order WHERE "sourceId" = $1 GROUP BY currency, month`,
                [source.id],
            )) as Array<{ currency: string; month: string; total: string; count: number }>;
        const actual: Record<string, string> = {};
        for (const row of rows) actual[`${row.currency}:${row.month}`] = row.total;
        const expected = (run.verification.expectedTotals as Record<string, string>) ?? {};
        const matches = Object.keys({ ...actual, ...expected }).every(key => actual[key] === expected[key]);
        const sampleComparisons = [];
        for (const sample of (run.verification.samples as Array<Record<string, unknown>>) ?? []) {
            const row = await this.connection
                .getRepository(ctx, LegacyOrder)
                .findOneBy({ sourceId: Number(source.id), sourceOrderId: String(sample.sourceKey) });
            const actualSample = row && {
                sourceKey: row.sourceOrderId,
                total: row.total,
                currency: row.currency,
                status: row.status,
                number: row.number,
                lines: digest(row.snapshot.line_items),
                notes: digest(row.snapshot._notes),
                refunds: digest(row.snapshot._refunds),
            };
            const fields = Object.keys(sample).filter(
                field => !actualSample || sample[field] !== actualSample[field as keyof typeof actualSample],
            );
            sampleComparisons.push({
                sourceKey: sample.sourceKey,
                matches: fields.length === 0,
                differentFields: fields,
            });
        }
        const images = await this.connection
            .getRepository(ctx, WooMapping)
            .countBy({ sourceId: Number(source.id), kind: 'images' });
        const mappingCounts: Record<string, number> = {};
        const skippedCounts: Record<string, number> = {};
        for (const kind of REST_STAGES) {
            mappingCounts[kind] = await this.connection
                .getRepository(ctx, WooMapping)
                .countBy({ sourceId: Number(source.id), kind });
            skippedCounts[kind] = await this.connection
                .getRepository(ctx, WooMapping)
                .countBy({ sourceId: Number(source.id), kind, targetId: IsNull() });
        }
        const sourceCounts = (run.verification.sourceCounts ?? {}) as Record<string, number>;
        const countsMatch = REST_STAGES.every(
            kind => sourceCounts[kind] == null || sourceCounts[kind] === mappingCounts[kind],
        );
        const readyImages = await this.connection
            .getRepository(ctx, Asset)
            .query(
                `SELECT count(*)::int AS count FROM woo_mapping m JOIN asset a ON a.id::text = m."targetId" JOIN bd_image i ON i.id = a."customFieldsBdimageid" WHERE m."sourceId" = $1 AND m.kind = 'images' AND i.status = 'ready'`,
                [source.id],
            )
            .catch(() => [{ count: null }]);
        return {
            ...run.verification,
            actualTotals: actual,
            matches: matches && countsMatch && sampleComparisons.every(s => s.matches),
            countsMatch,
            mappingCounts,
            skippedCounts,
            sampleComparisons,
            legacyOrderCount: rows.reduce((n, r) => n + r.count, 0),
            images,
            readyImages: readyImages[0]?.count ?? null,
        };
    }

    async legacyOrders(
        ctx: RequestContext,
        input: { sourceId?: number; customerId?: number; search?: string; skip?: number; take?: number },
    ) {
        const qb = this.connection
            .getRepository(ctx, LegacyOrder)
            .createQueryBuilder('o')
            .where('o.channelId = :channel', { channel: ctx.channelId });
        if (input.sourceId) qb.andWhere('o.sourceId = :sourceId', { sourceId: input.sourceId });
        if (input.customerId) qb.andWhere('o.customerId = :customerId', { customerId: input.customerId });
        if (input.search)
            qb.andWhere('(o.number = :search OR o.phone LIKE :phone)', {
                search: text(input.search, 100),
                phone: `%${text(input.search, 30).replace(/[\\%_]/g, '\\$&')}%`,
            });
        const [items, totalItems] = await qb
            .orderBy('o.placedAt', 'DESC')
            .addOrderBy('o.id', 'DESC')
            .skip(Math.max(0, input.skip ?? 0))
            .take(Math.min(100, Math.max(1, input.take ?? 25)))
            .getManyAndCount();
        return { items: items.map(({ snapshot: _snapshot, ...row }) => row), totalItems };
    }
    async legacyOrder(ctx: RequestContext, id: number) {
        return this.connection
            .getRepository(ctx, LegacyOrder)
            .findOneBy({ id, channelId: Number(ctx.channelId) });
    }
    async report(ctx: RequestContext, runId: number) {
        const run = await this.run(ctx, runId);
        const groups = await this.connection
            .getRepository(ctx, WooIssue)
            .createQueryBuilder('i')
            .select('i.code', 'code')
            .addSelect('i.severity', 'severity')
            .addSelect('count(*)', 'count')
            .where('i.runId = :runId', { runId })
            .groupBy('i.code')
            .addGroupBy('i.severity')
            .getRawMany();
        return {
            id: run.id,
            status: run.status,
            counts: run.counts,
            verification: run.verification,
            issues: groups,
            generatedAt: new Date(),
        };
    }
}

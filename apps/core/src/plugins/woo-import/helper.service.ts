import { Inject, Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { decryptSecret, encryptSecret, Keyring, parseKeyring } from '@ecommbd/shared';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WooPairing, WooChunk } from './helper-entities';
import { WooSource } from './entities';
import { WooRecord, sourceRecord, sourceSettings } from './helpers';
import { Resource, SourceConnector, SourcePage } from './rest-connector';
import { WOO_OPTIONS, WooImportOptions } from './options';
import { LessThan } from 'typeorm';
import { WooLegacyAuth } from './helper-entities';

export const HELPER_STAGES: Resource[] = [
    'categories',
    'tags',
    'products',
    'customers',
    'orders',
    'coupons',
    'reviews',
    'settings',
];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const equal = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const chunkSignature = (token: string, time: string, nonce: string, body: WooRecord) =>
    createHmac('sha256', token)
        .update(`${time}\n${nonce}\n${body.sequence}\n${body.kind}\n${body.payload}`)
        .digest('hex');

@Injectable()
export class WooHelperService {
    private keys?: Keyring;
    constructor(
        private connection: TransactionalConnection,
        @Inject(WOO_OPTIONS) private options: WooImportOptions,
    ) {
        if (options.encryptionKeys) this.keys = parseKeyring(options.encryptionKeys);
    }
    keyring() {
        if (!this.keys) throw new UserInputError('error.woo-import.encryption');
        return this.keys;
    }
    async createPairing(ctx: RequestContext, input: { url: string; imageHosts?: string[] }) {
        this.keyring();
        const url = new URL(input.url);
        const destination = new URL(this.options.publicUrl ?? '');
        if (
            url.protocol !== 'https:' ||
            destination.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            (input.imageHosts?.length ?? 0) > 20
        )
            throw new UserInputError('error.woo-import.input');
        const secret = randomBytes(32).toString('hex');
        return this.connection.withTransaction(ctx, async tx => {
            const sources = this.connection.getRepository(tx, WooSource);
            const existing = await sources.findOneBy({
                channelId: Number(ctx.channelId),
                url: url.href.replace(/\/$/, ''),
            });
            if (existing) {
                await sources.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [2100, existing.id]);
                const [active] = await sources.query(
                    "SELECT count(*)::int AS count FROM woo_run WHERE \"sourceId\"=$1 AND status IN ('queued','running')",
                    [existing.id],
                );
                if (active.count) throw new UserInputError('error.woo-import.busy');
                await this.revoke(tx, Number(existing.id));
            }
            const source = await sources.save(
                new WooSource({
                    ...existing,
                    channelId: Number(ctx.channelId),
                    url: url.href.replace(/\/$/, ''),
                    credentials: null,
                    imageHosts: [url.hostname, ...(input.imageHosts ?? []).map(h => h.toLowerCase())],
                    settings: { ...existing?.settings, transport: 'helper', helperPairingId: null },
                    completed: false,
                }),
            );
            const pairing = await this.connection.getRepository(tx, WooPairing).save(
                new WooPairing({
                    sourceId: Number(source.id),
                    codeHash: sha(secret),
                    expiresAt: new Date(Date.now() + 3600_000),
                    nextSequence: 0,
                    manifest: {},
                    finished: false,
                }),
            );
            return {
                sourceId: source.id,
                pairing: JSON.stringify({
                    endpoint: new URL('/woo-migrate', destination).href,
                    code: `${pairing.id}.${secret}`,
                }),
                expiresAt: pairing.expiresAt,
            };
        });
    }
    async pair(code: string, sourceUrl: string) {
        if (typeof code !== 'string' || !/^\d+\.[a-f0-9]{64}$/.test(code))
            throw new UserInputError('error.woo-import.pairing');
        const [id, secret] = code.split('.');
        return this.connection.rawConnection.transaction(async manager => {
            const repo = manager.getRepository(WooPairing);
            const pairing = await repo
                .createQueryBuilder('p')
                .addSelect('p.codeHash')
                .setLock('pessimistic_write')
                .where('p.id = :id', { id: Number(id) })
                .getOne();
            if (
                !pairing ||
                pairing.usedAt ||
                pairing.expiresAt <= new Date() ||
                !equal(pairing.codeHash, sha(secret))
            )
                throw new UserInputError('error.woo-import.pairing');
            const source = await manager.getRepository(WooSource).findOneByOrFail({ id: pairing.sourceId });
            if (source.url !== String(sourceUrl).replace(/\/$/, ''))
                throw new UserInputError('error.woo-import.pairing');
            const token = randomBytes(32).toString('hex');
            pairing.usedAt = new Date();
            pairing.tokenExpiresAt = new Date(Date.now() + 7 * 86400_000);
            pairing.token = encryptSecret(token, this.keyring(), `woo-upload:${pairing.id}`);
            await repo.save(pairing);
            return { id: pairing.id, token, expiresAt: pairing.tokenExpiresAt };
        });
    }
    async accept(id: number, body: WooRecord, time: string, nonce: string, signature: string) {
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new UserInputError('error.woo-import.chunk');
        const encoded = JSON.stringify(body);
        if (
            !Number.isSafeInteger(id) ||
            !/^\d{10}$/.test(time) ||
            Math.abs(Date.now() / 1000 - Number(time)) > 300 ||
            !/^[a-f0-9]{32}$/.test(nonce) ||
            !/^[a-f0-9]{64}$/.test(signature) ||
            Buffer.byteLength(encoded) > 2 * 1024 * 1024
        )
            throw new UserInputError('error.woo-import.chunk');
        return this.connection.rawConnection.transaction(async manager => {
            const repo = manager.getRepository(WooPairing);
            const pairing = await repo
                .createQueryBuilder('p')
                .addSelect('p.token')
                .setLock('pessimistic_write')
                .where('p.id = :id', { id })
                .getOne();
            if (!pairing?.token || !pairing.tokenExpiresAt || pairing.tokenExpiresAt <= new Date())
                throw new UserInputError('error.woo-import.pairing');
            const token = decryptSecret(pairing.token, this.keyring(), `woo-upload:${id}`);
            if (!equal(signature, chunkSignature(token, time, nonce, body)))
                throw new UserInputError('error.woo-import.chunk');
            if (typeof body.payload !== 'string') throw new UserInputError('error.woo-import.chunk');
            let decoded;
            try {
                decoded = JSON.parse(body.payload);
            } catch {
                throw new UserInputError('error.woo-import.chunk');
            }
            body = { ...body, records: decoded.records, manifest: decoded.manifest };
            const source = await manager.getRepository(WooSource).findOneByOrFail({ id: pairing.sourceId });
            if (source.completed) throw new UserInputError('error.woo-import.pairing');
            if (!Number.isSafeInteger(body.sequence) || body.sequence < 0)
                throw new UserInputError('error.woo-import.chunk');
            const old = await manager
                .getRepository(WooChunk)
                .findOneBy({ pairingId: id, sequence: body.sequence });
            if (old) {
                if (old.digest !== sha(encoded)) throw new UserInputError('error.woo-import.chunk');
                return { accepted: true, nextSequence: pairing.nextSequence };
            }
            if (
                pairing.finished ||
                pairing.nextSequence !== body.sequence ||
                (await manager.getRepository(WooChunk).exists({ where: { pairingId: id, nonce } }))
            )
                throw new UserInputError('error.woo-import.chunk');
            if (!HELPER_STAGES.includes(body.kind) && body.kind !== 'finish')
                throw new UserInputError('error.woo-import.chunk');
            if (!Array.isArray(body.records) || body.records.length > 100)
                throw new UserInputError('error.woo-import.chunk');
            body.records.forEach(sourceRecord);
            if (body.kind === 'finish') {
                if (body.records.length || !body.manifest || !/^[A-Z]{3}$/.test(body.manifest.currency))
                    throw new UserInputError('error.woo-import.chunk');
                for (const kind of HELPER_STAGES) {
                    const [row] = await manager.query(
                        'SELECT COALESCE(SUM("recordCount"),0)::int AS count FROM woo_chunk WHERE "pairingId"=$1 AND kind=$2',
                        [id, kind],
                    );
                    if (row.count !== body.manifest.counts?.[kind])
                        throw new UserInputError('error.woo-import.chunk');
                }
                pairing.finished = true;
                const inspection = sourceSettings(body.manifest);
                pairing.manifest = {
                    ...inspection,
                    counts: Object.fromEntries(HELPER_STAGES.map(kind => [kind, body.manifest.counts[kind]])),
                    watermark: String(body.manifest.watermark ?? '').slice(0, 40),
                };
                source.settings = {
                    ...source.settings,
                    helperPairingId: id,
                    currency: inspection.currency,
                    pricesIncludeTax: inspection.pricesIncludeTax,
                    taxesEnabled: inspection.taxesEnabled,
                    weightUnit: inspection.weightUnit,
                    inspection: pairing.manifest,
                };
                await manager.getRepository(WooSource).save(source);
            }
            await manager.getRepository(WooChunk).save(
                new WooChunk({
                    pairingId: id,
                    sequence: body.sequence,
                    kind: body.kind,
                    recordCount: body.records.length,
                    digest: sha(encoded),
                    nonce,
                    payload: encryptSecret(
                        JSON.stringify(body),
                        this.keyring(),
                        `woo-chunk:${id}:${body.sequence}`,
                    ),
                }),
            );
            pairing.nextSequence++;
            await repo.save(pairing);
            return { accepted: true, nextSequence: pairing.nextSequence };
        });
    }
    async connector(source: WooSource): Promise<SourceConnector> {
        const pairing = await this.connection.rawConnection.getRepository(WooPairing).findOneBy({
            id: Number(source.settings.helperPairingId),
            sourceId: Number(source.id),
            finished: true,
        });
        if (!pairing) throw new UserInputError('error.woo-import.helperNotReady');
        return new WooPushConnector(this.connection, pairing, this.keyring());
    }
    async revoke(ctx: RequestContext, sourceId: number) {
        await this.connection
            .getRepository(ctx, WooPairing)
            .update({ sourceId }, { token: null, tokenExpiresAt: null });
    }
    async cleanup() {
        const db = this.connection.rawConnection;
        await db.getRepository(WooLegacyAuth).delete({ expiresAt: LessThan(new Date()) });
        await db.query(
            `DELETE FROM woo_legacy_auth a WHERE NOT EXISTS (SELECT 1 FROM authentication_method n WHERE n."passwordHash" = 'woo:' || a.reference)`,
        );
        const expired = await db.getRepository(WooPairing).findBy({ tokenExpiresAt: LessThan(new Date()) });
        for (const pairing of expired) {
            await db.getRepository(WooChunk).delete({ pairingId: Number(pairing.id) });
            await db.getRepository(WooPairing).delete(pairing.id);
        }
    }
}

export class WooPushConnector implements SourceConnector {
    readonly stages = HELPER_STAGES;
    constructor(
        private connection: TransactionalConnection,
        private pairing: WooPairing,
        private keys: Keyring,
    ) {}
    async page(kind: Resource, offset: number, size: number): Promise<SourcePage> {
        const chunks = await this.connection.rawConnection
            .getRepository(WooChunk)
            .createQueryBuilder('c')
            .where('c.pairingId = :id AND c.kind = :kind', { id: this.pairing.id, kind })
            .orderBy('c.sequence', 'ASC')
            .getMany();
        let skipped = 0;
        const records: WooRecord[] = [];
        for (const chunk of chunks) {
            if (skipped + chunk.recordCount <= offset) {
                skipped += chunk.recordCount;
                continue;
            }
            const sealed = await this.connection.rawConnection
                .getRepository(WooChunk)
                .createQueryBuilder('c')
                .addSelect('c.payload')
                .where('c.id = :id', { id: chunk.id })
                .getOneOrFail();
            const parsed = JSON.parse(
                decryptSecret(sealed.payload, this.keys, `woo-chunk:${this.pairing.id}:${chunk.sequence}`),
            );
            records.push(
                ...parsed.records.slice(
                    Math.max(0, offset - skipped),
                    Math.max(0, offset - skipped) + size - records.length,
                ),
            );
            skipped += chunk.recordCount;
            if (records.length >= size) break;
        }
        return {
            records,
            size,
            total: Number((this.pairing.manifest.counts as Record<string, number>)[kind] ?? 0),
        };
    }
    async children() {
        return [];
    }
    async close() {}
}

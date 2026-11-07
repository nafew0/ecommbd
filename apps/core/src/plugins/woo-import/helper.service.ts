import { Inject, Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { decryptSecret, encryptSecret, Keyring, parseKeyring } from '@ecommbd/shared';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { WooPairing, WooChunk } from './helper-entities';
import { WooSource } from './entities';
import { WooRecord, sourceRecord, sourceSettings } from './helpers';
import { Resource, SourceConnector, SourcePage } from './rest-connector';
import { WOO_OPTIONS, WooImportOptions } from './options';
import { EntityManager, In, IsNull, LessThan, Not } from 'typeorm';
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
/** First line of an export file made by the WordPress helper's "Export to a file" (version 0.3.0+). */
export const EXPORT_FORMAT = 'ecommbd-woo-export';
/** Largest line of an export file: a chunk is under 2 MiB, as on the signed upload. */
const MAX_LINE_BYTES = 2 * 1024 * 1024;
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
            const source = await this.replaceSource(tx, url, input.imageHosts);
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
    /**
     * Makes (or resets) the source for a helper upload or an export file: its earlier upload is
     * dropped, and it waits for new chunks. Refused while an import of that source runs.
     */
    private async replaceSource(tx: RequestContext, url: URL, imageHosts: string[] = []) {
        const sources = this.connection.getRepository(tx, WooSource);
        const existing = await sources.findOneBy({
            channelId: Number(tx.channelId),
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
        return sources.save(
            new WooSource({
                ...existing,
                channelId: Number(tx.channelId),
                url: url.href.replace(/\/$/, ''),
                credentials: null,
                imageHosts: [url.hostname, ...imageHosts.map(h => h.toLowerCase())],
                settings: { ...existing?.settings, transport: 'helper', helperPairingId: null },
                completed: false,
            }),
        );
    }

    /**
     * Imports an export file from the WordPress helper ("Export to a file"), for old stores that
     * can't reach us. The file is JSON Lines (gzip or not): a header line, then exactly the chunks
     * the helper would have uploaded, ending with "finish". Each chunk goes through the same
     * checks as a signed upload (storeChunk), so the dry run and import that follow are the same.
     *
     * The file stands in for a pairing: a pairing row is made with no upload token (so the public
     * upload route can never add to it) and an expiry like an upload token's, after which the
     * daily cleanup deletes it with its chunks. Anything wrong in the file undoes the whole file.
     */
    async importFile(ctx: RequestContext, file: Readable, imageHosts: string[] = []) {
        this.keyring();
        if (
            !Array.isArray(imageHosts) ||
            imageHosts.length > 20 ||
            imageHosts.some(h => typeof h !== 'string')
        )
            throw new UserInputError('error.woo-import.input');
        // The upload itself is capped by Vendure's upload limit; gzip is spotted by its first bytes.
        const raw = await readAll(file);
        const input = Readable.from([raw]);
        const text = raw[0] === 0x1f && raw[1] === 0x8b ? input.pipe(createGunzip()) : input;
        const lines = createInterface({ input: text, crlfDelay: Infinity });
        let pairingId: number | undefined;
        let sourceId: ID | undefined;
        let number = 0;
        try {
            for await (const raw of lines) {
                number++;
                const line = raw.trim();
                if (!line) continue;
                if (Buffer.byteLength(line) > MAX_LINE_BYTES)
                    throw new UserInputError('error.woo-import.fileLine', { line: number });
                let parsed: WooRecord;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    throw new UserInputError(
                        pairingId ? 'error.woo-import.fileLine' : 'error.woo-import.fileFormat',
                        { line: number },
                    );
                }
                if (!pairingId) {
                    const created = await this.startFile(ctx, parsed, imageHosts);
                    pairingId = created.pairingId;
                    sourceId = created.sourceId;
                    continue;
                }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new UserInputError('error.woo-import.fileLine', { line: number });
                const body: WooRecord = {
                    sequence: parsed.sequence,
                    kind: parsed.kind,
                    payload: parsed.payload,
                };
                const id = pairingId;
                await this.connection.rawConnection.transaction(async manager => {
                    const pairing = await manager
                        .getRepository(WooPairing)
                        .createQueryBuilder('p')
                        .setLock('pessimistic_write')
                        .where('p.id = :id', { id })
                        .getOneOrFail();
                    try {
                        const nonce = randomBytes(16).toString('hex');
                        await this.storeChunk(manager, pairing, body, JSON.stringify(body), nonce);
                    } catch (refused) {
                        // Say which line, rather than the upload's "check its signature" message.
                        if (refused instanceof UserInputError)
                            throw new UserInputError('error.woo-import.fileLine', { line: number });
                        throw refused;
                    }
                });
            }
            if (!pairingId) throw new UserInputError('error.woo-import.fileFormat');
            const finished = await this.connection.rawConnection
                .getRepository(WooPairing)
                .findOneBy({ id: pairingId, finished: true });
            if (!finished) throw new UserInputError('error.woo-import.fileIncomplete');
            return { sourceId, counts: finished.manifest.counts as Record<string, number> };
        } catch (error) {
            // All or nothing: a half-read file leaves no chunks behind to import by mistake.
            if (pairingId) {
                await this.connection.rawConnection.getRepository(WooChunk).delete({ pairingId });
                await this.connection.rawConnection.getRepository(WooPairing).delete(pairingId);
            }
            // A damaged gzip file fails while it is being read.
            if (
                typeof (error as { code?: unknown })?.code === 'string' &&
                /^Z_/.test((error as { code: string }).code)
            )
                throw new UserInputError('error.woo-import.fileFormat');
            throw error;
        }
    }

    /** Checks an export file's header line and makes its source and its token-less pairing. */
    private async startFile(ctx: RequestContext, header: WooRecord, imageHosts: string[]) {
        let url: URL;
        try {
            url = new URL(String(header?.sourceUrl ?? ''));
        } catch {
            throw new UserInputError('error.woo-import.fileFormat');
        }
        if (
            !header ||
            header.format !== EXPORT_FORMAT ||
            header.version !== 1 ||
            // http too: an export file doesn't travel over the old site's connection, and test
            // copies of a store often have no certificate.
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        )
            throw new UserInputError('error.woo-import.fileFormat');
        return this.connection.withTransaction(ctx, async tx => {
            const source = await this.replaceSource(tx, url, imageHosts);
            const now = new Date();
            const pairing = await this.connection.getRepository(tx, WooPairing).save(
                new WooPairing({
                    sourceId: Number(source.id),
                    // Never a usable pairing code: nobody knows this secret.
                    codeHash: sha(randomBytes(32).toString('hex')),
                    expiresAt: now,
                    usedAt: now,
                    token: null,
                    tokenExpiresAt: new Date(now.getTime() + 7 * 86400_000),
                    nextSequence: 0,
                    manifest: {},
                    finished: false,
                }),
            );
            return { pairingId: Number(pairing.id), sourceId: source.id };
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
        // Check the signature before taking any lock. This endpoint is public: an unsigned request
        // now costs one read, and can never hold the pairing row that the real upload needs.
        const unlocked = await this.connection.rawConnection
            .getRepository(WooPairing)
            .createQueryBuilder('p')
            .addSelect('p.token')
            .where('p.id = :id', { id })
            .getOne();
        if (!unlocked?.token || !this.signedWith(unlocked, id, time, nonce, body, signature))
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
            // Checked again under the lock: the token may have been revoked or replaced meanwhile.
            if (!this.signedWith(pairing, id, time, nonce, body, signature))
                throw new UserInputError('error.woo-import.chunk');
            return this.storeChunk(manager, pairing, body, encoded, nonce);
        });
    }

    /**
     * Checks one chunk and stores it, encrypted. Shared by the signed upload and the export file.
     *
     * Chunks must come in sequence; resending an accepted chunk unchanged is acknowledged again,
     * a changed one is refused. The "finish" chunk must report exactly the record counts stored,
     * and marks the upload ready to import. The caller holds the pairing's row lock.
     */
    private async storeChunk(
        manager: EntityManager,
        pairing: WooPairing,
        body: WooRecord,
        encoded: string,
        nonce: string,
    ) {
        const id = Number(pairing.id);
        const repo = manager.getRepository(WooPairing);
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
    }
    /** Whether the chunk was signed with this pairing's upload token (constant-time compare). */
    private signedWith(
        pairing: WooPairing,
        id: number,
        time: string,
        nonce: string,
        body: WooRecord,
        signature: string,
    ): boolean {
        if (!pairing.token) return false;
        const token = decryptSecret(pairing.token, this.keyring(), `woo-upload:${id}`);
        return equal(signature, chunkSignature(token, time, nonce, body));
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
    /**
     * Stops a source's helper uploads: tokens are cleared, and the uploaded chunks are deleted
     * with them. The chunks hold every customer's WordPress password hash, so they must not
     * outlive the pairing that brought them (they used to stay until the migration was completed).
     * Re-pairing and the final "complete" both call this; a new pairing uploads afresh.
     */
    async revoke(ctx: RequestContext, sourceId: number) {
        const pairings = this.connection.getRepository(ctx, WooPairing);
        const ids = (await pairings.findBy({ sourceId })).map(pairing => Number(pairing.id));
        if (ids.length) await this.connection.getRepository(ctx, WooChunk).delete({ pairingId: In(ids) });
        await pairings.update({ sourceId }, { token: null, tokenExpiresAt: null });
        // With its upload gone, the source has no helper data to import until it pairs again.
        await this.connection
            .getRepository(ctx, WooSource)
            .query(
                `UPDATE woo_source SET settings = settings || '{"helperPairingId": null}'::jsonb WHERE id = $1`,
                [sourceId],
            );
    }

    /**
     * Removes the WordPress password hashes from a pairing's uploaded customer records once an
     * import has stored them (encrypted, one per customer, in `woo_legacy_auth`). The rest of
     * the upload stays for review and re-runs. The chunk's digest is left as it was uploaded, so
     * a re-sent copy of the same chunk is still recognized.
     */
    async dropPasswordHashes(pairingId: number) {
        const repo = this.connection.rawConnection.getRepository(WooChunk);
        const chunks = await repo
            .createQueryBuilder('c')
            .addSelect('c.payload')
            .where('c.pairingId = :pairingId AND c.kind = :kind', { pairingId, kind: 'customers' })
            .getMany();
        for (const chunk of chunks) {
            const context = `woo-chunk:${pairingId}:${chunk.sequence}`;
            const body = JSON.parse(decryptSecret(chunk.payload, this.keyring(), context)) as WooRecord;
            const records = Array.isArray(body.records) ? (body.records as WooRecord[]) : [];
            if (!records.some(record => '_password_hash' in record)) continue;
            for (const record of records) delete record._password_hash;
            // The signed `payload` string is the original upload, hashes included: drop it too.
            delete body.payload;
            await repo.update(chunk.id, {
                payload: encryptSecret(JSON.stringify(body), this.keyring(), context),
            });
        }
    }

    /**
     * Daily: expired legacy passwords (12 months, docs/decisions.md), legacy records whose login
     * has since been upgraded or reset, and pairings that are over, with their uploads. A pairing
     * is over when its upload token has expired, when it was revoked (token cleared), or when its
     * one-hour pairing code was never used.
     */
    async cleanup() {
        const db = this.connection.rawConnection;
        await db.getRepository(WooLegacyAuth).delete({ expiresAt: LessThan(new Date()) });
        await db.query(
            `DELETE FROM woo_legacy_auth a WHERE NOT EXISTS (SELECT 1 FROM authentication_method n WHERE n."passwordHash" = 'woo:' || a.reference)`,
        );
        const now = new Date();
        const over = await db.getRepository(WooPairing).find({
            where: [
                { tokenExpiresAt: LessThan(now) },
                { usedAt: Not(IsNull()), tokenExpiresAt: IsNull() },
                { usedAt: IsNull(), expiresAt: LessThan(now) },
            ],
        });
        for (const pairing of over) {
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

/** Reads a whole upload into memory (it is small: Vendure caps uploads, and the file is gzipped). */
async function readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

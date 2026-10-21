import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import {
    Asset,
    AssetEvent,
    ConfigService,
    EventBus,
    type ID,
    type JobQueue,
    JobQueueService,
    Logger,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGES_PLUGIN_OPTIONS, loggerCtx, ORPHAN_GRACE_DAYS, ORPHAN_MARKER } from './constants';
import { contentHash, makeVariants } from './image-processing';
import type { ImagesPluginOptions } from './types';

const HASH = /^[0-9a-f]{64}$/;

/**
 * Makes the storefront's WebP sizes for every image asset, in the worker: `<imagesDir>/<sha256 of
 * the clean image>/<width>.webp`, served at `/img/<hash>/<width>.webp` with immutable caching.
 * The same image uploaded twice has the same hash, so its sizes are stored once. Files are written
 * to a temporary name and renamed, so a restart or two uploads at once never leave half a file.
 */
@Injectable()
export class ImageVariantsService implements OnModuleInit, OnApplicationBootstrap {
    private queue: JobQueue<{ assetId: ID }> | undefined;

    constructor(
        @Inject(IMAGES_PLUGIN_OPTIONS) private options: ImagesPluginOptions,
        private jobQueueService: JobQueueService,
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private eventBus: EventBus,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'bd-image-variants',
            process: async job => {
                await this.process(job.data.assetId);
            },
        });
    }

    onApplicationBootstrap() {
        this.eventBus.ofType(AssetEvent).subscribe(event => {
            if (event.type === 'created' && event.entity.type === 'IMAGE') {
                void this.enqueue(event.entity.id);
            }
        });
    }

    enqueue(assetId: ID) {
        return this.queue?.add({ assetId }, { retries: 3 });
    }

    /** Makes (or remakes) the sizes of one asset. Safe to run again: same input, same files. */
    async process(assetId: ID): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(Asset);
        const asset = await repository.findOne({ where: { id: assetId } });
        if (!asset || asset.type !== 'IMAGE') return;
        try {
            const source = await this.configService.assetOptions.assetStorageStrategy.readFileToBuffer(
                asset.source,
            );
            const hash = contentHash(source);
            const variants = await makeVariants(source);
            const dir = path.join(this.options.imagesDir, hash);
            await mkdir(dir, { recursive: true });
            await rm(path.join(dir, ORPHAN_MARKER), { force: true });
            for (const file of variants.files) {
                const target = path.join(dir, `${file.width}.webp`);
                const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
                await writeFile(temporary, file.data);
                await rename(temporary, target);
            }
            await repository.update(asset.id, {
                customFields: {
                    contentHash: hash,
                    imageWidths: variants.widths.join(','),
                    dominantColor: variants.dominantColor,
                    placeholder: variants.placeholder,
                    imageStatus: 'ready',
                    variantBytes: variants.files.reduce((sum, file) => sum + file.data.byteLength, 0),
                },
            });
        } catch (error) {
            // Disk full, a broken file…: the asset shows "processing failed" and the error is logged for staff.
            Logger.error(`Could not make image sizes for asset ${assetId}: ${String(error)}`, loggerCtx);
            await repository.update(asset.id, { customFields: { imageStatus: 'failed' } });
            throw error;
        }
    }

    /** `npm run images:regenerate`: every image asset, or one. */
    async regenerate(assetId?: ID): Promise<number> {
        const repository = this.connection.rawConnection.getRepository(Asset);
        const assets = assetId
            ? await repository.find({ where: { id: assetId }, select: { id: true } })
            : await repository.find({ where: { type: 'IMAGE' as never }, select: { id: true } });
        for (const asset of assets) {
            await this.process(asset.id);
        }
        return assets.length;
    }

    /**
     * Daily: sizes no asset uses any more are first marked, then deleted after the grace period,
     * so an asset deleted by mistake can be restored with its sizes for a week.
     */
    async removeOrphans(now = Date.now()): Promise<{ marked: number; deleted: number }> {
        const rows: Array<{ hash: string }> = await this.connection.rawConnection.query(
            `SELECT DISTINCT "customFieldsContenthash" AS hash FROM "asset" WHERE "customFieldsContenthash" IS NOT NULL`,
        );
        const used = new Set(rows.map(row => row.hash));
        const entries = await readdir(this.options.imagesDir).catch(() => [] as string[]);
        let marked = 0;
        let deleted = 0;
        for (const hash of entries.filter(entry => HASH.test(entry) && !used.has(entry))) {
            const marker = path.join(this.options.imagesDir, hash, ORPHAN_MARKER);
            const markedAt = await stat(marker).then(
                s => s.mtimeMs,
                () => null,
            );
            if (markedAt === null) {
                await writeFile(marker, '');
                marked += 1;
            } else if (now - markedAt > ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000) {
                await rm(path.join(this.options.imagesDir, hash), { recursive: true, force: true });
                deleted += 1;
            }
        }
        return { marked, deleted };
    }

    /** Bytes used by images (originals and sizes), for plan limits later (phase 39). */
    async usage(ctx: RequestContext) {
        const [row] = await this.connection.getRepository(ctx, Asset).query(
            `SELECT COUNT(*)::int AS assets,
                    COALESCE(SUM("fileSize"), 0)::bigint AS "sourceBytes",
                    COALESCE(SUM("customFieldsVariantbytes"), 0)::bigint AS "variantBytes"
             FROM "asset" WHERE "type" = 'IMAGE'`,
        );
        const sourceBytes = Number(row.sourceBytes);
        const variantBytes = Number(row.variantBytes);
        return {
            assets: row.assets as number,
            sourceBytes,
            variantBytes,
            totalBytes: sourceBytes + variantBytes,
        };
    }
}

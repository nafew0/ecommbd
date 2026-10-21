import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
    Asset,
    AssetEvent,
    AssetService,
    AssetType,
    ConfigService,
    EventBus,
    type ID,
    type JobQueue,
    JobQueueService,
    Logger,
    type MimeTypeError,
    RequestContext,
    TransactionalConnection,
    type Translated,
} from '@vendure/core';
import { Readable } from 'node:stream';
import { BdImage } from './bd-image.entity';
import { DELETE_GRACE_DAYS, IMAGE_JOB_QUEUE } from './constants';
import { ASSET_IMAGE_COLUMN } from './custom-fields';
import { ImageFiles } from './image-files';
import { contentHash, makeVariants } from './pipeline';
import { BD_IMAGES_OPTIONS, type BdImagesOptions, loggerCtx } from './types';

interface ImageJob {
    assetId: ID;
    force?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `NOT EXISTS (an asset showing image i)`, for the hand-written SQL below. */
const UNUSED = `NOT EXISTS (SELECT 1 FROM "asset" a WHERE a."${ASSET_IMAGE_COLUMN}" = i."id")`;

/** Short, log-safe reason for a failure: an error code such as ENOSPC, or the error's name. */
function failureOf(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string') return code.slice(0, 200);
    return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
}

/**
 * The WebP sizes of every image asset (roadmap phase 09). A job on the worker makes them after an
 * upload; the same picture uploaded twice shares one `BdImage` and one set of files.
 */
@Injectable()
export class BdImageService implements OnModuleInit {
    private queue?: JobQueue<ImageJob>;
    readonly files: ImageFiles;

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private jobQueueService: JobQueueService,
        private assetService: AssetService,
        private eventBus: EventBus,
        @Inject(BD_IMAGES_OPTIONS) options: BdImagesOptions,
    ) {
        this.files = new ImageFiles(options.dir);
    }

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue<ImageJob>({
            name: IMAGE_JOB_QUEUE,
            process: async job => {
                const image = await this.process(job.data.assetId, { force: job.data.force });
                return { status: image?.status ?? 'skipped' };
            },
        });
    }

    /** Queues the WebP sizes of an asset. Retried 3 times; each run starts over, so it's idempotent. */
    async enqueue(assetId: ID, force = false) {
        await this.queue?.add({ assetId, force }, { retries: 3 });
    }

    /**
     * Makes (or reuses) the WebP sizes of an asset and links the asset to them. `force` makes them
     * again even when they exist; `regenerated` skips hashes already remade in this run.
     */
    async process(
        assetId: ID,
        options: { force?: boolean; regenerated?: Set<string> } = {},
    ): Promise<BdImage | undefined> {
        const db = this.connection.rawConnection;
        const asset = await db.getRepository(Asset).findOne({ where: { id: assetId } });
        if (!asset || asset.type !== AssetType.IMAGE) return undefined;
        const source = await this.configService.assetOptions.assetStorageStrategy.readFileToBuffer(
            asset.source,
        );
        const hash = contentHash(source);
        const images = db.getRepository(BdImage);
        // Two uploads of the same picture at once: the unique hash lets exactly one row exist.
        await images.createQueryBuilder().insert().values({ hash }).orIgnore().execute();
        const image = await images.findOneByOrFail({ hash });
        await db.query(`UPDATE "asset" SET "${ASSET_IMAGE_COLUMN}" = $1 WHERE "id" = $2`, [
            image.id,
            asset.id,
        ]);
        if (image.orphanedAt) {
            image.orphanedAt = null;
            await images.update(image.id, { orphanedAt: null });
        }
        const force = options.force && !options.regenerated?.has(hash);
        const sizes = image.variants?.map(variant => variant.size) ?? [];
        if (!force && image.status === 'ready' && (await this.files.exist(hash, sizes))) {
            return image;
        }
        try {
            const made = await makeVariants(source);
            await this.files.write(hash, made.variants);
            image.status = 'ready';
            image.failure = null;
            image.width = made.width;
            image.height = made.height;
            image.animated = made.animated;
            image.variants = made.variants.map(({ size, width, height, data }) => ({
                size,
                width,
                height,
                bytes: data.byteLength,
            }));
            image.bytes = made.variants.reduce((sum, variant) => sum + variant.data.byteLength, 0);
            image.dominantColor = made.dominantColor;
            image.placeholder = made.placeholder;
            await images.save(image);
            options.regenerated?.add(hash);
            return image;
        } catch (error) {
            const failure = failureOf(error);
            await images.update(image.id, { status: 'failed', failure });
            // Staff see "processing failed" on the image; the error log alerts operations.
            Logger.error(`WebP sizes failed for asset ${asset.id}: ${failure}`, loggerCtx);
            throw error;
        }
    }

    /**
     * The pipeline's entry point for imports (WooCommerce, phase 21): the same checks and cleaning
     * as an upload, then the same job. Returns Vendure's `MimeTypeError` for a refused file type and
     * throws `BdImageRejectedError` for the other refusals.
     */
    async createImageAsset(
        ctx: RequestContext,
        input: { data: Buffer; fileName: string },
    ): Promise<Translated<Asset> | MimeTypeError> {
        const result = await this.assetService.createFromFileStream(
            Readable.from(input.data),
            input.fileName,
            ctx,
        );
        if (result instanceof Asset) {
            // Vendure publishes no event for this path; ours starts the job once the transaction commits.
            await this.eventBus.publish(new AssetEvent(ctx, result, 'created', { file: input.fileName }));
        }
        return result;
    }

    /** Remakes the sizes of one asset or of every image asset, e.g. after a quality change. */
    async regenerate(options: { assetId?: ID; onProgress?(done: number, failed: number): void } = {}) {
        const regenerated = new Set<string>();
        let done = 0;
        let failed = 0;
        const run = async (id: ID) => {
            try {
                if (await this.process(id, { force: true, regenerated })) done++;
            } catch {
                failed++;
            }
            options.onProgress?.(done, failed);
        };
        if (options.assetId !== undefined) {
            await run(options.assetId);
            return { done, failed };
        }
        const assets = this.connection.rawConnection.getRepository(Asset);
        for (let skip = 0; ; skip += 100) {
            const page = await assets.find({
                select: { id: true },
                where: { type: AssetType.IMAGE },
                order: { id: 'ASC' },
                skip,
                take: 100,
            });
            for (const asset of page) await run(asset.id);
            if (page.length < 100) break;
        }
        return { done, failed };
    }

    /**
     * Hourly: marks images no asset shows any more, and deletes the files of those unused for
     * `DELETE_GRACE_DAYS`. An image used again in the meantime is unmarked (and kept).
     */
    async sweep(now = new Date()): Promise<{ marked: number; deleted: number }> {
        const db = this.connection.rawConnection;
        const [, marked] = (await db.query(
            `UPDATE "bd_image" i SET "orphanedAt" = $1 WHERE "orphanedAt" IS NULL AND ${UNUSED}`,
            [now],
        )) as [unknown, number];
        await db.query(
            `UPDATE "bd_image" i SET "orphanedAt" = NULL WHERE "orphanedAt" IS NOT NULL AND NOT ${UNUSED}`,
        );
        const [rows] = (await db.query(
            `DELETE FROM "bd_image" i WHERE "orphanedAt" < $1 AND ${UNUSED} RETURNING "hash"`,
            [new Date(now.getTime() - DELETE_GRACE_DAYS * DAY_MS)],
        )) as [Array<{ hash: string }>, number];
        for (const { hash } of rows) await this.files.remove(hash);
        return { marked, deleted: rows.length };
    }

    /** Pictures stored and bytes used (Vendure's source files plus our sizes), for plan limits (phase 39). */
    async usage(ctx: RequestContext): Promise<{ images: number; bytes: number }> {
        const db = this.connection.getRepository(ctx, BdImage);
        const [ours] = (await db.query(
            `SELECT count(*)::int AS "images", coalesce(sum("bytes"), 0)::bigint AS "bytes" FROM "bd_image"`,
        )) as Array<{ images: number; bytes: string }>;
        const [theirs] = (await db.query(
            `SELECT coalesce(sum("fileSize"), 0)::bigint AS "bytes" FROM "asset"`,
        )) as Array<{
            bytes: string;
        }>;
        return { images: ours.images, bytes: Number(ours.bytes) + Number(theirs.bytes) };
    }
}

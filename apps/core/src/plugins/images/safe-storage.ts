import type { AssetStorageStrategy, Injector } from '@vendure/core';
import { UserInputError } from '@vendure/core';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { cleanUpload, ImageError, MAX_UPLOAD_BYTES } from './image-processing';

/**
 * Files made by Vendure from a source already cleaned: previews (`preview/…__preview.<ext>`, the
 * DefaultAssetNamingStrategy) and the asset server's resized copies (`cache/…`).
 */
const isPreview = (fileName: string) =>
    /^(preview|cache)\//.test(fileName) || /__preview(\.[a-z0-9]+)?$/i.test(fileName);

async function readLimited(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.byteLength;
        if (size > MAX_UPLOAD_BYTES) {
            stream.destroy();
            throw new ImageError('TOO_LARGE');
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

/**
 * Wraps the real asset storage (the asset server's files in production) so that every source image
 * is checked and re-encoded by `cleanUpload()` before it's written: Dashboard and admin uploads,
 * and imports (phase 21), all go through here. Previews Vendure makes from the clean source are
 * stored as they are. A refused image is a user error with a Bangla or English message.
 */
export class SafeImageStorageStrategy implements AssetStorageStrategy {
    constructor(private readonly inner: AssetStorageStrategy) {}

    async init(injector: Injector) {
        await this.inner.init?.(injector);
    }

    async destroy() {
        await this.inner.destroy?.();
    }

    async writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        return this.inner.writeFileFromBuffer(fileName, isPreview(fileName) ? data : await clean(data));
    }

    async writeFileFromStream(fileName: string, data: Readable): Promise<string> {
        if (isPreview(fileName)) {
            return this.inner.writeFileFromStream(fileName, data);
        }
        const buffer = await readLimited(data).catch(rethrow);
        return this.inner.writeFileFromBuffer(fileName, await clean(buffer));
    }

    readFileToBuffer(identifier: string) {
        return this.inner.readFileToBuffer(identifier);
    }

    readFileToStream(identifier: string) {
        return this.inner.readFileToStream(identifier);
    }

    deleteFile(identifier: string) {
        return this.inner.deleteFile(identifier);
    }

    fileExists(fileName: string) {
        return this.inner.fileExists(fileName);
    }

    toAbsoluteUrl(request: Request, identifier: string): string {
        return this.inner.toAbsoluteUrl ? this.inner.toAbsoluteUrl(request, identifier) : identifier;
    }
}

async function clean(data: Buffer): Promise<Buffer> {
    try {
        return (await cleanUpload(data)).data;
    } catch (error) {
        return rethrow(error);
    }
}

function rethrow(error: unknown): never {
    if (error instanceof ImageError) {
        throw new UserInputError(`message.images.${error.code}`);
    }
    throw error;
}

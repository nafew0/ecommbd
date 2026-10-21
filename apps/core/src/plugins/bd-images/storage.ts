import type { AssetStorageStrategy, Injector } from '@vendure/core';
import type { Request } from 'express';
import type { Readable, Stream } from 'node:stream';
import { MAX_UPLOAD_BYTES } from './constants';
import { BdImageRejectedError } from './errors';
import { cleanImage, ImageRejectedError } from './pipeline';

/** Vendure's source files are named `source/…` by the naming strategy this plugin sets. */
export function isSourceFile(fileName: string): boolean {
    return fileName.startsWith('source/');
}

async function readAll(stream: Stream, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream as Readable) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        size += buffer.byteLength;
        if (size > limit) {
            (stream as Readable).destroy();
            throw new BdImageRejectedError('too-large');
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

/**
 * Wraps the real storage (local disk, later S3) so every uploaded image is checked and cleaned
 * before it is written (see `cleanImage`): the raw upload never reaches the disk, and a refused file
 * leaves nothing behind. Previews and other files pass through unchanged.
 */
export class CleanImageStorageStrategy implements AssetStorageStrategy {
    readonly toAbsoluteUrl?: (request: Request, identifier: string) => string;

    constructor(private readonly inner: AssetStorageStrategy) {
        if (inner.toAbsoluteUrl) {
            this.toAbsoluteUrl = inner.toAbsoluteUrl.bind(inner);
        }
    }

    async init(injector: Injector) {
        await this.inner.init?.(injector);
    }

    async destroy() {
        await this.inner.destroy?.();
    }

    async writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        return this.inner.writeFileFromBuffer(fileName, isSourceFile(fileName) ? await clean(data) : data);
    }

    async writeFileFromStream(fileName: string, data: Stream): Promise<string> {
        if (!isSourceFile(fileName)) {
            return this.inner.writeFileFromStream(fileName, data);
        }
        return this.inner.writeFileFromBuffer(fileName, await clean(await readAll(data, MAX_UPLOAD_BYTES)));
    }

    readFileToBuffer(identifier: string): Promise<Buffer> {
        return this.inner.readFileToBuffer(identifier);
    }

    readFileToStream(identifier: string): Promise<Stream> {
        return this.inner.readFileToStream(identifier);
    }

    deleteFile(identifier: string): Promise<void> {
        return this.inner.deleteFile(identifier);
    }

    fileExists(fileName: string): Promise<boolean> {
        return this.inner.fileExists(fileName);
    }
}

async function clean(data: Buffer): Promise<Buffer> {
    try {
        return (await cleanImage(data)).data;
    } catch (error) {
        if (error instanceof ImageRejectedError) throw new BdImageRejectedError(error.reason);
        throw error;
    }
}

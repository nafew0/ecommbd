import type { AssetStorageStrategy } from '@vendure/core';
import { Readable } from 'node:stream';

/**
 * Asset storage in memory, for tests that need to read back what was stored (Vendure's
 * TestingAssetStorageStrategy keeps nothing and always returns the same picture).
 */
export class MemoryAssetStorageStrategy implements AssetStorageStrategy {
    readonly files = new Map<string, Buffer>();

    async writeFileFromBuffer(fileName: string, data: Buffer) {
        this.files.set(fileName, Buffer.from(data));
        return fileName;
    }

    async writeFileFromStream(fileName: string, data: Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of data) chunks.push(Buffer.from(chunk as Uint8Array));
        return this.writeFileFromBuffer(fileName, Buffer.concat(chunks));
    }

    async readFileToBuffer(identifier: string) {
        const file = this.files.get(identifier);
        if (!file) throw new Error(`No file ${identifier}`);
        return file;
    }

    async readFileToStream(identifier: string) {
        return Readable.from(await this.readFileToBuffer(identifier));
    }

    async deleteFile(identifier: string) {
        this.files.delete(identifier);
    }

    async fileExists(fileName: string) {
        return this.files.has(fileName);
    }

    toAbsoluteUrl(_request: unknown, identifier: string) {
        return `test-url/${identifier}`;
    }
}

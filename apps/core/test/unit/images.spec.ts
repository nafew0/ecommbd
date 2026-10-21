import type { AssetStorageStrategy } from '@vendure/core';
import express from 'express';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../../src/plugins/bd-images/constants';
import { BdImageRejectedError } from '../../src/plugins/bd-images/errors';
import { createImageRouter, ImageFiles } from '../../src/plugins/bd-images/image-files';
import {
    cleanImage,
    contentHash,
    ImageRejectedError,
    makeVariants,
    variantSizes,
} from '../../src/plugins/bd-images/pipeline';
import { CleanImageStorageStrategy } from '../../src/plugins/bd-images/storage';
import {
    alphaPng,
    animatedGif,
    bombPng,
    cmykJpeg,
    gpsJpeg,
    heic,
    SVG_WITH_SCRIPT,
    tinyPng,
    truncatedJpeg,
} from '../support/images';

async function rejection(input: Buffer | Promise<Buffer>) {
    try {
        await cleanImage(await input);
    } catch (error) {
        if (error instanceof ImageRejectedError) return error.reason;
        throw error;
    }
    return 'accepted';
}

describe('cleaning an upload', () => {
    it('turns a phone photo upright and removes its EXIF, GPS location included', async () => {
        const input = await gpsJpeg(400, 300);
        expect((await sharp(input).metadata()).exif).toBeDefined();
        const clean = await cleanImage(input);
        const metadata = await sharp(clean.data).metadata();
        expect(clean.format).toBe('jpeg');
        // Orientation 6 means "rotate 90°": the stored picture is now portrait.
        expect([metadata.width, metadata.height]).toEqual([300, 400]);
        expect(metadata.exif).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
        expect(clean.data.includes('PhoneMaker')).toBe(false);
    });

    it('converts CMYK to sRGB', async () => {
        const clean = await cleanImage(await cmykJpeg());
        expect((await sharp(clean.data).metadata()).space).toBe('srgb');
    });

    it('keeps PNG transparency', async () => {
        const clean = await cleanImage(await alphaPng());
        const { data, info } = await sharp(clean.data).raw().toBuffer({ resolveWithObject: true });
        expect(info.channels).toBe(4);
        expect(data[3]).toBe(0); // the corner is transparent
    });

    it('keeps an animated GIF animated', async () => {
        const clean = await cleanImage(await animatedGif());
        expect(clean).toMatchObject({ format: 'gif', animated: true, width: 120, height: 90 });
        expect((await sharp(clean.data, { animated: true }).metadata()).pages).toBe(3);
    });

    it('cleans the same upload to the same bytes, so its hash finds the copy stored before', async () => {
        const input = await gpsJpeg();
        const [first, second] = await Promise.all([cleanImage(input), cleanImage(input)]);
        expect(contentHash(first.data)).toBe(contentHash(second.data));
        expect(contentHash(first.data)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuses what is not a safe JPEG, PNG, WebP, GIF or AVIF', async () => {
        expect(await rejection(bombPng())).toBe('too-many-pixels');
        expect(await rejection(truncatedJpeg())).toBe('unreadable');
        expect(await rejection(SVG_WITH_SCRIPT)).toBe('unsupported');
        expect(await rejection(heic())).toBe('heic');
        expect(await rejection(Buffer.from('not an image at all'))).toBe('unreadable');
        expect(await rejection(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).toBe('too-large');
    });

    it('accepts AVIF and WebP', async () => {
        const base = sharp({ create: { width: 50, height: 40, channels: 3, background: '#468' } });
        expect((await cleanImage(await base.clone().avif().toBuffer())).format).toBe('avif');
        expect((await cleanImage(await base.clone().webp().toBuffer())).format).toBe('webp');
    });
});

describe('WebP sizes', () => {
    it('makes every width up to the picture, never wider', () => {
        expect(variantSizes(4032)).toEqual([160, 320, 480, 768, 1080, 1600]);
        expect(variantSizes(1600)).toEqual([160, 320, 480, 768, 1080, 1600]);
        expect(variantSizes(1000)).toEqual([160, 320, 480, 768, 1000]);
        expect(variantSizes(160)).toEqual([160]);
        expect(variantSizes(100)).toEqual([100]);
    });

    it('keeps only the original size of a tiny image', async () => {
        const made = await makeVariants((await cleanImage(await tinyPng())).data);
        expect(made.variants.map(({ size, width, height }) => ({ size, width, height }))).toEqual([
            { size: 100, width: 100, height: 80 },
        ]);
        expect((await sharp(made.variants[0].data).metadata()).format).toBe('webp');
    });

    it('keeps transparency, and gives a dominant colour and a tiny placeholder', async () => {
        const made = await makeVariants((await cleanImage(await alphaPng())).data);
        expect((await sharp(made.variants[0].data).metadata()).hasAlpha).toBe(true);
        expect(made.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(made.placeholder).toMatch(/^data:image\/webp;base64,/);
        expect(made.placeholder.length).toBeLessThan(400);
    });

    it('makes animated WebP from an animated GIF', async () => {
        const made = await makeVariants((await cleanImage(await animatedGif())).data);
        expect(made.animated).toBe(true);
        const metadata = await sharp(made.variants[0].data, { animated: true }).metadata();
        expect([metadata.format, metadata.pages]).toEqual(['webp', 3]);
    });

    it('scales a panorama by width, and caps the height of a very tall picture', async () => {
        const panorama = await sharp({
            create: { width: 6000, height: 300, channels: 3, background: '#888' },
        })
            .jpeg()
            .toBuffer();
        const wide = await makeVariants(panorama);
        expect(wide.variants[wide.variants.length - 1]).toMatchObject({
            size: 1600,
            width: 1600,
            height: 80,
        });

        const tall = await sharp({ create: { width: 500, height: 6000, channels: 3, background: '#888' } })
            .jpeg()
            .toBuffer();
        const capped = await makeVariants(tall);
        for (const variant of capped.variants) {
            expect(variant.height).toBeLessThanOrEqual(variant.size * 4);
        }
        expect(capped.variants[0]).toMatchObject({ size: 160, width: 53, height: 640 });
    });
});

/** A storage strategy that only remembers what was written. */
function memoryStorage() {
    const written = new Map<string, Buffer>();
    const storage: AssetStorageStrategy = {
        async writeFileFromBuffer(fileName, data) {
            written.set(fileName, data);
            return fileName;
        },
        async writeFileFromStream(fileName, data) {
            const chunks: Buffer[] = [];
            for await (const chunk of data as Readable) chunks.push(chunk as Buffer);
            written.set(fileName, Buffer.concat(chunks));
            return fileName;
        },
        readFileToBuffer: async id => written.get(id) ?? Buffer.alloc(0),
        readFileToStream: async id => Readable.from(written.get(id) ?? Buffer.alloc(0)),
        deleteFile: async id => void written.delete(id),
        fileExists: async id => written.has(id),
    };
    return { storage, written };
}

describe('the storage wrapper', () => {
    it('cleans an uploaded file before it is written, and passes previews through', async () => {
        const { storage, written } = memoryStorage();
        const wrapper = new CleanImageStorageStrategy(storage);
        const input = await gpsJpeg();
        await wrapper.writeFileFromStream('source/ab/photo.jpg', Readable.from(input));
        await wrapper.writeFileFromBuffer('preview/cd/photo__preview.jpg', input);
        expect((await sharp(written.get('source/ab/photo.jpg')).metadata()).exif).toBeUndefined();
        expect(written.get('preview/cd/photo__preview.jpg')).toEqual(input);
        expect(wrapper.toAbsoluteUrl).toBeUndefined();
    });

    it('refuses a bad upload with a translated error and writes nothing', async () => {
        const { storage, written } = memoryStorage();
        const wrapper = new CleanImageStorageStrategy(storage);
        const error = await wrapper
            .writeFileFromBuffer('source/ab/bomb.png', await bombPng())
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BdImageRejectedError);
        expect(error).toMatchObject({
            message: 'error.bd-image.too-many-pixels',
            extensions: { code: 'BD_IMAGE_TOO_MANY_PIXELS' },
        });
        const tooLarge = await wrapper
            .writeFileFromStream(
                'source/ab/big.jpg',
                Readable.from([Buffer.alloc(MAX_UPLOAD_BYTES), Buffer.alloc(1)]),
            )
            .catch((caught: unknown) => caught);
        expect(tooLarge).toMatchObject({ extensions: { code: 'BD_IMAGE_TOO_LARGE' } });
        expect(written.size).toBe(0);
    });
});

describe('the image files and /img', () => {
    let dir: string;
    let base: string;
    let close: () => void;
    const hash = 'a'.repeat(64);

    beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommbd-images-'));
        const app = express();
        app.use('/img', createImageRouter(dir));
        const server = app.listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/img`;
        close = () => server.close();
    });

    afterAll(async () => {
        close();
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('writes sizes, removes ones no longer made, and deletes the folder', async () => {
        const files = new ImageFiles(dir);
        const variant = (size: number) => ({
            size,
            width: size,
            height: size,
            data: Buffer.from(`webp ${size}`),
        });
        await files.write(hash, [variant(160), variant(320)]);
        expect(await files.exist(hash, [160, 320])).toBe(true);
        await files.write(hash, [variant(160)]);
        expect(await fs.readdir(path.join(dir, hash))).toEqual(['160.webp']);
        expect(await files.exist(hash, [])).toBe(false);
        await files.remove(hash);
        expect(await files.exist(hash, [160])).toBe(false);
        await expect(files.write('../etc', [variant(160)])).rejects.toThrow('Invalid image hash');
    });

    it('serves a size as immutable WebP with nosniff, and nothing else', async () => {
        await new ImageFiles(dir).write(hash, [
            { size: 160, width: 160, height: 90, data: Buffer.from('RIFF') },
        ]);
        const response = await fetch(`${base}/${hash}/160.webp`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        for (const other of [
            `/${hash}/`,
            `/${hash}`,
            `/${hash}/999.webp`,
            '/../package.json',
            `/${hash}/160.png`,
        ]) {
            const refused = await fetch(`${base}${other}`);
            expect(refused.status, other).toBe(404);
            expect(refused.headers.get('x-content-type-options')).toBe('nosniff');
        }
    });
});

import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageVariantsService } from '../../src/plugins/images';
import { MemoryAssetStorageStrategy } from '../support/memory-asset-storage';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3059;
const storage = new MemoryAssetStorageStrategy();
const config = createTestConfig(PORT, { assetOptions: { assetStorageStrategy: storage } });
const { server, adminClient } = createTestEnvironment(config);
const base = `http://localhost:${PORT}`;

const CREATE_ASSETS = gql`
    mutation CreateAssets($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            ... on Asset {
                id
                source
                width
                height
                mimeType
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const ASSET = gql`
    query ($id: ID!) {
        asset(id: $id) {
            id
            customFields {
                contentHash
                imageWidths
                dominantColor
                placeholder
                imageStatus
                variantBytes
            }
        }
    }
`;

let dir: string;

async function upload(name: string, data: Buffer) {
    const file = path.join(dir, name);
    await writeFile(file, data);
    const result = await adminClient.fileUploadMutation({
        mutation: CREATE_ASSETS,
        filePaths: [file],
        mapVariables: () => ({ input: [{ file: null }] }),
    });
    return result.createAssets[0];
}

async function ready(id: string) {
    for (let i = 0; i < 100; i += 1) {
        const { asset } = await adminClient.query(ASSET, { id });
        if (asset.customFields.imageStatus !== 'pending') return asset;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Asset ${id} never got its sizes`);
}

const photo = (width: number, height: number, background = '#c85028') =>
    sharp({ create: { width, height, channels: 3, background } });

beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ecommbd-images-e2e-'));
    await server.init({ initialData: testInitialData, customerCount: 0 });
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

describe('uploads', () => {
    it('stores a clean source and serves WebP sizes with immutable caching', async () => {
        const withGps = await photo(2000, 1500)
            .withExif({
                IFD0: { Make: 'TestPhone' },
                IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' },
            })
            .jpeg()
            .toBuffer();
        const created = await upload('phone.jpg', withGps);
        expect(created).toMatchObject({ mimeType: 'image/jpeg', width: 2000, height: 1500 });
        const stored = await storage.readFileToBuffer(created.source.replace(/^test-url\//, ''));
        expect((await sharp(stored).metadata()).exif).toBeUndefined();

        const asset = await ready(created.id);
        expect(asset.customFields).toMatchObject({
            imageStatus: 'ready',
            imageWidths: '160,320,480,768,1080,1600',
            // sharp groups colours into bins, so it's close to #c85028 rather than exact.
            dominantColor: expect.stringMatching(/^#c[0-9a-f]{5}$/),
        });
        expect(asset.customFields.placeholder).toMatch(/^data:image\/webp;base64,/);
        expect(asset.customFields.variantBytes).toBeGreaterThan(0);

        const response = await fetch(`${base}/img/${asset.customFields.contentHash}/480.webp`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toContain('immutable');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(480);
        // No directory listing.
        expect((await fetch(`${base}/img/${asset.customFields.contentHash}/`)).status).toBe(404);
    });

    it('stores the same image once', async () => {
        const png = await photo(640, 480, '#2060c0').png().toBuffer();
        const [a, b] = await Promise.all([upload('a.png', png), upload('b.png', png)]);
        const [first, second] = await Promise.all([ready(a.id), ready(b.id)]);
        expect(first.customFields.contentHash).toBe(second.customFields.contentHash);
    });

    it('refuses SVG and HEIC as the wrong type, and a pixel bomb, with a clear message', async () => {
        const svg = await upload(
            'logo.svg',
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        );
        expect(svg).toMatchObject({
            errorCode: 'MIME_TYPE_ERROR',
            message: 'Please upload a JPG, PNG or WebP image.',
        });
        const heic = await upload(
            'photo.heic',
            Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]),
        );
        expect(heic.errorCode).toBe('MIME_TYPE_ERROR');

        const bomb = await photo(8000, 6000, '#ffffff').png({ compressionLevel: 9 }).toBuffer();
        await expect(upload('bomb.png', bomb)).rejects.toThrow(/more than 40 megapixels/);
        const jpeg = await photo(800, 600).jpeg().toBuffer();
        await expect(upload('half.jpg', jpeg.subarray(0, jpeg.length / 2))).rejects.toThrow(
            /damaged or incomplete/,
        );
    });
});

describe('housekeeping', () => {
    it('reports the storage used', async () => {
        const { bdImageUsage } = await adminClient.query(gql`
            {
                bdImageUsage {
                    assets
                    sourceBytes
                    variantBytes
                    totalBytes
                }
            }
        `);
        expect(bdImageUsage.assets).toBeGreaterThanOrEqual(3);
        expect(bdImageUsage.totalBytes).toBe(bdImageUsage.sourceBytes + bdImageUsage.variantBytes);
    });

    it('deletes the sizes of a deleted image only after the grace period', async () => {
        const created = await upload('gone.png', await photo(300, 300, '#10a010').png().toBuffer());
        const asset = await ready(created.id);
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    deleteAsset(input: { assetId: $id, force: true }) {
                        result
                    }
                }
            `,
            { id: created.id },
        );
        const service = server.app.get(ImageVariantsService);
        const url = `${base}/img/${asset.customFields.contentHash}/160.webp`;
        expect(await service.removeOrphans()).toMatchObject({ marked: 1, deleted: 0 });
        expect((await fetch(url)).status).toBe(200);
        expect(await service.removeOrphans(Date.now() + 8 * 24 * 60 * 60 * 1000)).toMatchObject({
            deleted: 1,
        });
        expect((await fetch(url)).status).toBe(404);
    });

    it('regenerates sizes on request', async () => {
        const created = await upload('again.png', await photo(400, 400).png().toBuffer());
        await ready(created.id);
        // The service takes database IDs; the test API shows them as T_<id>.
        const id = Number(String(created.id).replace('T_', ''));
        expect(await server.app.get(ImageVariantsService).regenerate(id)).toBe(1);
    });
});

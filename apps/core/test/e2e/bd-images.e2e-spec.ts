import { ConfigService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdImageRejectedError, BdImageService } from '../../src/plugins/bd-images';
import {
    animatedGif,
    bombPng,
    gpsJpeg,
    heic,
    phonePhoto,
    SVG_WITH_SCRIPT,
    tinyPng,
    truncatedJpeg,
} from '../support/images';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3058;
const BASE = `http://localhost:${PORT}`;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

const CREATE_ASSETS = `
    mutation ($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            __typename
            ... on Asset { id source width height fileSize }
            ... on MimeTypeError { errorCode message mimeType }
        }
    }
`;

interface UploadResponse {
    data?: {
        createAssets: Array<{
            __typename: string;
            id?: string;
            source?: string;
            width?: number;
            height?: number;
            errorCode?: string;
            message?: string;
            mimeType?: string;
        }>;
    };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

/** The type a browser sends for a file name. */
const TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    heic: 'image/heic',
};

/** A GraphQL multipart upload, as the admin sends it, returning the raw response (errors included). */
async function upload(data: Buffer, fileName: string, options: { type?: string; language?: string } = {}) {
    const type = options.type ?? TYPES[fileName.split('.').pop()!.toLowerCase()];
    const form = new FormData();
    form.append(
        'operations',
        JSON.stringify({ query: CREATE_ASSETS, variables: { input: [{ file: null }] } }),
    );
    form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
    form.append('0', new Blob([new Uint8Array(data)], { type }), fileName);
    const response = await fetch(`${BASE}/admin-api?languageCode=${options.language ?? 'en'}`, {
        method: 'POST',
        body: form,
        headers: {
            authorization: `Bearer ${adminClient.getAuthToken()}`,
            'apollo-require-preflight': 'true',
        },
    });
    return (await response.json()) as UploadResponse;
}

async function uploadAsset(data: Buffer, fileName: string) {
    const response = await upload(data, fileName);
    const asset = response.data?.createAssets[0];
    if (!asset?.id) throw new Error(`Upload refused: ${JSON.stringify(response)}`);
    return asset as { id: string; source: string; width: number; height: number };
}

const ASSET_IMAGE = gql`
    query ($id: ID!) {
        asset(id: $id) {
            id
            customFields {
                bdImage {
                    id
                    status
                    failure
                    width
                    height
                    animated
                    dominantColor
                    placeholder
                    srcset
                    variants {
                        width
                        height
                        url
                    }
                }
            }
        }
    }
`;

interface ImageInfo {
    id: string;
    status: string;
    failure: string | null;
    width: number;
    height: number;
    animated: boolean;
    dominantColor: string | null;
    placeholder: string | null;
    srcset: string;
    variants: Array<{ width: number; height: number; url: string }>;
}

async function imageOf(assetId: string): Promise<ImageInfo | null> {
    const { asset } = await adminClient.query<{ asset: { customFields: { bdImage: ImageInfo | null } } }>(
        ASSET_IMAGE,
        { id: assetId },
    );
    return asset.customFields.bdImage;
}

/** Waits for the worker job (in-process in tests) to finish an asset's sizes. */
async function processed(assetId: string): Promise<ImageInfo> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const image = await imageOf(assetId);
        if (image && image.status !== 'pending') return image;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Asset ${assetId} was never processed`);
}

async function assetCount(): Promise<number> {
    const { assets } = await adminClient.query<{ assets: { totalItems: number } }>(gql`
        query {
            assets {
                totalItems
            }
        }
    `);
    return assets.totalItems;
}

const images = () => server.app.get(BdImageService);

/** Vendure's test config encodes IDs in the API (`T_7`); the service takes database IDs. */
const dbId = (id: string) => id.replace(/^T_/, '');

describe('image pipeline (phase 09)', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('turns a 5 MB phone photo into WebP sizes under 400 KB, location removed, cached as immutable', async () => {
        const photo = await phonePhoto();
        expect(photo.byteLength).toBeGreaterThan(4.5 * 1024 * 1024);
        const asset = await uploadAsset(photo, 'IMG_2041.jpg');
        expect([asset.width, asset.height]).toEqual([4032, 3024]);

        // What Vendure stored (and serves at /assets/source) is the cleaned copy: no EXIF, no GPS.
        const storage = server.app.get(ConfigService).assetOptions.assetStorageStrategy;
        const stored = await storage.readFileToBuffer(asset.source);
        expect((await sharp(stored).metadata()).exif).toBeUndefined();

        const image = await processed(asset.id);
        expect(image).toMatchObject({ status: 'ready', width: 4032, height: 3024, animated: false });
        expect(image.variants.map(variant => variant.width)).toEqual([160, 320, 480, 768, 1080, 1600]);
        expect(image.srcset).toContain('/160.webp 160w, ');
        expect(image.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(image.placeholder!.length).toBeLessThan(400);

        let total = 0;
        const bytes: Record<number, number> = {};
        for (const variant of image.variants) {
            const response = await fetch(`${BASE}${variant.url}`);
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('image/webp');
            expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            expect(response.headers.get('x-content-type-options')).toBe('nosniff');
            const body = Buffer.from(await response.arrayBuffer());
            expect((await sharp(body).metadata()).exif).toBeUndefined();
            bytes[variant.width] = body.byteLength;
            total += body.byteLength;
        }
        const kb = (value: number) => `${Math.round(value / 1024)} KB`;
        const list = Object.entries(bytes).map(([width, size]) => `${width}px ${kb(size)}`);
        console.log(
            `Phone photo ${(photo.byteLength / 1024 / 1024).toFixed(1)} MB → ${list.join(', ')}; ${kb(total)} in all`,
        );
        expect(total).toBeLessThan(400 * 1024);
        expect(bytes[1080]).toBeLessThan(150 * 1024);
    });

    it('rejects every unsafe or unsupported file with a clear message, storing nothing', async () => {
        const before = await assetCount();

        const bomb = await upload(await bombPng(), 'poster.png');
        expect(bomb.errors?.[0]).toMatchObject({
            message:
                'This image has too many pixels (over 40 megapixels). Please make it smaller and try again.',
            extensions: { code: 'BD_IMAGE_TOO_MANY_PIXELS' },
        });

        const truncated = await upload(await truncatedJpeg(), 'half.jpg', { language: 'bn' });
        expect(truncated.errors?.[0]).toMatchObject({
            message: 'ছবির ফাইলটি নষ্ট বা অসম্পূর্ণ। অন্য একটি ফাইল দিন।',
            extensions: { code: 'BD_IMAGE_UNREADABLE' },
        });

        // Refused by type: Vendure compares the declared type, the extension and the bytes.
        const svg = await upload(SVG_WITH_SCRIPT, 'logo.svg');
        expect(svg.data?.createAssets[0]).toMatchObject({
            errorCode: 'MIME_TYPE_ERROR',
            message: 'Please upload JPG or PNG (WebP, GIF and AVIF also work).',
        });
        const iphone = await upload(heic(), 'IMG_0001.HEIC', { type: 'image/heic', language: 'bn' });
        expect(iphone.data?.createAssets[0]).toMatchObject({
            errorCode: 'MIME_TYPE_ERROR',
            mimeType: 'image/heic',
            message: 'JPG বা PNG ছবি দিন (WebP, GIF ও AVIF-ও চলবে)।',
        });
        // An SVG named and sent as a PNG gets past the type check, and is caught by decoding it.
        const disguised = await upload(SVG_WITH_SCRIPT, 'logo.png', { type: 'image/png' });
        expect(disguised.errors?.[0]?.extensions?.code).toBe('BD_IMAGE_UNSUPPORTED');
        // So is an iPhone photo renamed to .jpg.
        const renamed = await upload(heic(), 'IMG_0001.jpg', { type: 'image/jpeg' });
        expect(renamed.data?.createAssets[0]).toMatchObject({ errorCode: 'MIME_TYPE_ERROR' });

        const tooLarge = await upload(Buffer.alloc(15 * 1024 * 1024 + 10), 'huge.jpg');
        expect(tooLarge.errors?.length).toBeGreaterThan(0);

        expect(await assetCount()).toBe(before);
    });

    it('stores the same picture once, even when uploaded twice at the same moment', async () => {
        const picture = await gpsJpeg(900, 600);
        const [first, second] = await Promise.all([
            uploadAsset(picture, 'shirt.jpg'),
            uploadAsset(picture, 'shirt-copy.jpg'),
        ]);
        expect(first.id).not.toBe(second.id);
        const [a, b] = await Promise.all([processed(first.id), processed(second.id)]);
        expect(a.id).toBe(b.id);
        expect(a.variants).toEqual(b.variants);
        const rows = (await server.app
            .get(TransactionalConnection)
            .rawConnection.query(`SELECT count(*)::int AS n FROM bd_image WHERE id = $1`, [
                dbId(a.id),
            ])) as Array<{
            n: number;
        }>;
        expect(rows[0].n).toBe(1);
    });

    it('keeps a tiny image at its own size and an animated GIF animated', async () => {
        const tiny = await processed((await uploadAsset(await tinyPng(), 'icon.png')).id);
        expect(tiny.variants.map(({ width, height }) => [width, height])).toEqual([[100, 80]]);

        const gif = await processed((await uploadAsset(await animatedGif(), 'sale.gif')).id);
        expect(gif.animated).toBe(true);
        const body = Buffer.from(await (await fetch(`${BASE}${gif.variants[0].url}`)).arrayBuffer());
        expect((await sharp(body, { animated: true }).metadata()).pages).toBe(3);
    });

    it('shows the sizes in the Shop API, without the staff-only failure reason', async () => {
        const asset = await uploadAsset(await gpsJpeg(640, 480), 'panjabi.jpg');
        await processed(asset.id);
        const { createProduct } = await adminClient.query<{ createProduct: { id: string } }>(
            gql`
                mutation ($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    featuredAssetId: asset.id,
                    assetIds: [asset.id],
                    translations: [{ languageCode: 'en', name: 'Panjabi', slug: 'panjabi', description: '' }],
                },
            },
        );
        const { product } = await shopClient.query<{
            product: { featuredAsset: { customFields: { bdImage: { status: string; srcset: string } } } };
        }>(
            gql`
                query ($id: ID!) {
                    product(id: $id) {
                        featuredAsset {
                            customFields {
                                bdImage {
                                    status
                                    srcset
                                    variants {
                                        width
                                        url
                                    }
                                }
                            }
                        }
                    }
                }
            `,
            { id: createProduct.id },
        );
        expect(product.featuredAsset.customFields.bdImage.status).toBe('ready');
        expect(product.featuredAsset.customFields.bdImage.srcset).toMatch(
            /^\/img\/[0-9a-f]{64}\/160\.webp 160w/,
        );
        await expect(
            shopClient.query(gql`
                query {
                    product(slug: "panjabi") {
                        featuredAsset {
                            customFields {
                                bdImage {
                                    failure
                                }
                            }
                        }
                    }
                }
            `),
        ).rejects.toThrow(/Cannot query field "failure"/);
    });

    it('marks a failed job as failed, and finishes the image when run again', async () => {
        const asset = await uploadAsset(await gpsJpeg(500, 500), 'kurti.jpg');
        await processed(asset.id);
        const service = images();
        const write = service.files.write.bind(service.files);
        service.files.write = async () => {
            throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        };
        try {
            await expect(service.process(dbId(asset.id), { force: true })).rejects.toThrow('no space left');
        } finally {
            service.files.write = write;
        }
        expect(await imageOf(asset.id)).toMatchObject({ status: 'failed', failure: 'ENOSPC', variants: [] });
        await service.process(dbId(asset.id));
        expect(await imageOf(asset.id)).toMatchObject({ status: 'ready', failure: null });
        expect(await service.regenerate({ assetId: dbId(asset.id) })).toEqual({ done: 1, failed: 0 });
    });

    it('deletes the sizes 7 days after no asset uses them, and keeps shared ones', async () => {
        const service = images();
        const picture = await gpsJpeg(300, 300);
        const alone = await uploadAsset(await gpsJpeg(310, 300), 'alone.jpg');
        const shared = [await uploadAsset(picture, 'a.jpg'), await uploadAsset(picture, 'b.jpg')];
        const aloneImage = await processed(alone.id);
        const sharedImage = await processed(shared[0].id);
        await processed(shared[1].id);
        const deleteAsset = gql`
            mutation ($id: ID!) {
                deleteAsset(input: { assetId: $id }) {
                    result
                }
            }
        `;
        await adminClient.query(deleteAsset, { id: alone.id });
        await adminClient.query(deleteAsset, { id: shared[0].id });

        const now = new Date();
        expect((await service.sweep(now)).marked).toBeGreaterThanOrEqual(1);
        const aloneUrl = `${BASE}${aloneImage.variants[0].url}`;
        expect((await fetch(aloneUrl)).status).toBe(200);

        const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
        expect((await service.sweep(later)).deleted).toBeGreaterThanOrEqual(1);
        expect((await fetch(aloneUrl)).status).toBe(404);
        // Still shown by asset b.
        expect((await fetch(`${BASE}${sharedImage.variants[0].url}`)).status).toBe(200);
        expect((await imageOf(shared[1].id))?.status).toBe('ready');
    });

    it('lets imports use the same checks and job (for phase 21)', async () => {
        const service = images();
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const imported = await service.createImageAsset(ctx, {
            data: await gpsJpeg(700, 500),
            fileName: 'woo-1.jpg',
        });
        expect('id' in imported).toBe(true);
        const image = await processed(`T_${(imported as { id: string | number }).id}`);
        expect(image.status).toBe('ready');
        await expect(
            service.createImageAsset(ctx, { data: await bombPng(), fileName: 'woo-2.png' }),
        ).rejects.toBeInstanceOf(BdImageRejectedError);
    });

    it('reports pictures and bytes used', async () => {
        const { bdImageUsage } = await adminClient.query<{ bdImageUsage: { images: number; bytes: number } }>(
            gql`
                query {
                    bdImageUsage {
                        images
                        bytes
                    }
                }
            `,
        );
        expect(bdImageUsage.images).toBeGreaterThan(3);
        expect(bdImageUsage.bytes).toBeGreaterThan(500 * 1024);
    });
});

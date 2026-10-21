import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanUpload, ImageError, makeVariants } from '../../src/plugins/images/image-processing';

/**
 * The image fixture set (roadmap phase 09), made here with sharp so no binary files live in the
 * repo: GPS EXIF, rotation, CMYK, transparency, animation, a pixel bomb, truncation, SVG, HEIC,
 * tiny and duplicate images, and the size budget for a phone photo.
 */

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
    sharp({
        create: {
            width,
            height,
            channels,
            background: { r: 200, g: 80, b: 40, alpha: channels === 4 ? 0.5 : 1 },
        },
    });

/**
 * Something like a 12-megapixel phone photo: smooth shapes plus fine sensor grain. The grain makes
 * the JPEG big, and averages away when the photo is made smaller, as real photos do.
 */
async function phonePhoto(): Promise<Buffer> {
    const width = 4000;
    const height = 3000;
    const pixels = Buffer.alloc(width * height * 3);
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 3;
            const base = 120 + 60 * Math.sin(x / 300) * Math.cos(y / 250);
            for (let c = 0; c < 3; c += 1) {
                pixels[i + c] = Math.max(0, Math.min(255, base + c * 20 + (random() - 0.5) * 36));
            }
        }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
        .withExif({ IFD0: { Make: 'TestPhone', Model: 'X1' } })
        .jpeg({ quality: 95 })
        .toBuffer();
}

const refuse = async (data: Buffer, code: string) => {
    await expect(cleanUpload(data)).rejects.toSatisfy(
        (error: unknown) => error instanceof ImageError && error.code === code,
    );
};

describe('cleanUpload', () => {
    it('removes EXIF, including GPS location', async () => {
        const withGps = await solid(1200, 800)
            .withExif({
                IFD0: { Make: 'TestPhone' },
                IFD3: {
                    GPSLatitudeRef: 'N',
                    GPSLatitude: '23/1 48/1 0/1',
                    GPSLongitudeRef: 'E',
                    GPSLongitude: '90/1 24/1 0/1',
                },
            })
            .jpeg()
            .toBuffer();
        expect((await sharp(withGps).metadata()).exif).toBeDefined();
        const clean = await cleanUpload(withGps);
        const metadata = await sharp(clean.data).metadata();
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(clean).toMatchObject({ format: 'jpeg', width: 1200, height: 800 });
    });

    it('applies the EXIF rotation, then forgets it', async () => {
        const sideways = await solid(300, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
        const clean = await cleanUpload(sideways);
        expect(clean).toMatchObject({ width: 200, height: 300 });
        expect((await sharp(clean.data).metadata()).orientation).toBeUndefined();
    });

    it('turns CMYK into sRGB', async () => {
        const cmyk = await solid(400, 300).toColourspace('cmyk').jpeg().toBuffer();
        expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
        expect((await sharp((await cleanUpload(cmyk)).data).metadata()).space).toBe('srgb');
    });

    it('keeps PNG transparency', async () => {
        const png = await solid(400, 300, 4).png().toBuffer();
        const clean = await cleanUpload(png);
        expect(clean.format).toBe('png');
        expect((await sharp(clean.data).metadata()).hasAlpha).toBe(true);
    });

    it('keeps an animated GIF animated', async () => {
        const frames = await Promise.all([
            solid(200, 200).png().toBuffer(),
            sharp({ create: { width: 200, height: 200, channels: 3, background: '#2060c0' } })
                .png()
                .toBuffer(),
        ]);
        const gif = await sharp(frames, { join: { animated: true } })
            .gif()
            .toBuffer();
        const clean = await cleanUpload(gif);
        expect(clean.format).toBe('gif');
        expect((await sharp(clean.data, { animated: true }).metadata()).pages).toBe(2);
    });

    it('refuses a decompression bomb (48 megapixels in a tiny file)', async () => {
        const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } })
            .png({ compressionLevel: 9 })
            .toBuffer();
        expect(bomb.byteLength).toBeLessThan(1024 * 1024);
        await refuse(bomb, 'TOO_MANY_PIXELS');
    });

    it('refuses a truncated file, an SVG with a script, HEIC, text and huge files', async () => {
        const jpeg = await solid(800, 600).jpeg().toBuffer();
        await refuse(jpeg.subarray(0, Math.floor(jpeg.length / 2)), 'CORRUPT');
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
        );
        await refuse(svg, 'UNSUPPORTED');
        const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
        await refuse(heic, 'HEIC');
        await refuse(Buffer.from('not an image at all'), 'CORRUPT');
        await refuse(Buffer.alloc(16 * 1024 * 1024), 'TOO_LARGE');
    });
});

describe('makeVariants', () => {
    let photo: Buffer;
    beforeAll(async () => {
        photo = await phonePhoto();
    }, 60_000);

    it('makes small WebP sizes from a 5 MB phone photo: under 400 KB in total, the 1080 one under 150 KB', async () => {
        expect(photo.byteLength).toBeGreaterThan(5 * 1024 * 1024);
        const clean = await cleanUpload(photo);
        const variants = await makeVariants(clean.data);
        expect(variants.widths).toEqual([160, 320, 480, 768, 1080, 1600]);
        const total = variants.files.reduce((sum, file) => sum + file.data.byteLength, 0);
        expect(total).toBeLessThan(400 * 1024);
        const w1080 = variants.files.find(file => file.width === 1080)!;
        expect(w1080.data.byteLength).toBeLessThan(150 * 1024);
        const meta = await sharp(w1080.data).metadata();
        expect(meta).toMatchObject({ format: 'webp', width: 1080, height: 810 });
        expect(meta.exif).toBeUndefined();
        expect(variants.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(variants.placeholder.length).toBeLessThan(600);
    }, 60_000);

    it('never upscales: a tiny image keeps only its own size', async () => {
        const variants = await makeVariants(await solid(100, 80).png().toBuffer());
        expect(variants.widths).toEqual([100]);
        expect((await sharp(variants.files[0]!.data).metadata()).width).toBe(100);
    });

    it('keeps transparency, and caps very tall images', async () => {
        const variants = await makeVariants(await solid(500, 4000, 4).png().toBuffer());
        expect(variants.widths).toEqual([160, 320, 480]);
        const meta = await sharp(variants.files[0]!.data).metadata();
        expect(meta.hasAlpha).toBe(true);
        expect(meta.height).toBeLessThanOrEqual(160 * 4);
    });

    it('gives the same file the same bytes (so a duplicate is stored once)', async () => {
        const png = await solid(400, 300).png().toBuffer();
        const [a, b] = await Promise.all([cleanUpload(png), cleanUpload(png)]);
        expect(a.data.equals(b.data)).toBe(true);
    });
});

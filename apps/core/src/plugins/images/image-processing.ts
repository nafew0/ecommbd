import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * The image pipeline (roadmap phase 09), as plain functions over sharp so they're easy to test:
 * cleaning an upload before it's stored, and making the WebP sizes the storefront uses.
 */

/** Widths made for every image (never larger than the image itself). */
export const IMAGE_WIDTHS = [160, 320, 480, 768, 1080, 1600] as const;
export const WEBP_QUALITY = 78;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** About 40 megapixels: stops decompression bombs (a small file that decodes to gigabytes). */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Animated images: at most this many frames, and the animated WebP at most this big (else the first frame). */
export const MAX_FRAMES = 100;
export const MAX_ANIMATED_VARIANT_BYTES = 2 * 1024 * 1024;
/** Very tall images (screenshots, size charts) are capped at this many times their width. */
const MAX_ASPECT = 4;

export const IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif'] as const;
type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const IMAGE_ERROR_CODES = ['TOO_LARGE', 'TOO_MANY_PIXELS', 'UNSUPPORTED', 'HEIC', 'CORRUPT'] as const;
export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number];

/** Why an upload was refused; the message shown is `message.images.<code>`. */
export class ImageError extends Error {
    constructor(readonly code: ImageErrorCode) {
        super(`Image refused: ${code}`);
        this.name = 'ImageError';
    }
}

export interface CleanImage {
    data: Buffer;
    format: ImageFormat;
    width: number;
    height: number;
}

/** HEIC/HEIF from iPhones: sharp's prebuilt binaries can't decode HEVC, so we say so clearly. */
function isHeic(data: Buffer): boolean {
    if (data.length < 12 || data.toString('latin1', 4, 8) !== 'ftyp') return false;
    const brand = data.toString('latin1', 8, 12);
    return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}

/**
 * Checks an upload and re-encodes it before anything is stored: the type comes from the bytes,
 * the pixel count is limited, EXIF orientation is applied, every bit of metadata (including GPS
 * location from phone photos) is removed, CMYK becomes sRGB, and transparency is kept.
 * Re-encoding also removes anything hidden inside the file (polyglots).
 */
export async function cleanUpload(data: Buffer): Promise<CleanImage> {
    if (data.byteLength > MAX_UPLOAD_BYTES) throw new ImageError('TOO_LARGE');
    if (isHeic(data)) throw new ImageError('HEIC');
    let metadata: sharp.Metadata;
    try {
        metadata = await sharp(data, { limitInputPixels: false }).metadata();
    } catch {
        throw new ImageError('CORRUPT');
    }
    const format = metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format;
    if (!format || !(IMAGE_FORMATS as readonly string[]).includes(format)) {
        throw new ImageError(format === 'heif' ? 'HEIC' : 'UNSUPPORTED');
    }
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    if ((metadata.width ?? 0) * frameHeight > MAX_INPUT_PIXELS) throw new ImageError('TOO_MANY_PIXELS');
    const animated = (metadata.pages ?? 1) > 1;
    try {
        let image = sharp(data, {
            limitInputPixels: MAX_INPUT_PIXELS,
            animated,
            pages: animated ? Math.min(metadata.pages ?? 1, MAX_FRAMES) : 1,
            failOn: 'error',
        })
            .autoOrient()
            .toColourspace('srgb');
        image =
            format === 'jpeg'
                ? image.jpeg({ quality: 90, mozjpeg: true })
                : format === 'png'
                  ? image.png({ compressionLevel: 9 })
                  : format === 'webp'
                    ? image.webp({ quality: 90 })
                    : format === 'gif'
                      ? image.gif()
                      : image.avif({ quality: 60 });
        const { data: out, info } = await image.toBuffer({ resolveWithObject: true });
        return {
            data: out,
            format: format as ImageFormat,
            width: info.width,
            height: info.pageHeight ?? info.height,
        };
    } catch (error) {
        if (error instanceof Error && /pixel limit/i.test(error.message))
            throw new ImageError('TOO_MANY_PIXELS');
        throw new ImageError('CORRUPT');
    }
}

export const contentHash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export interface ImageVariants {
    width: number;
    height: number;
    /** The widths made (each ≤ the image's width; a tiny image gets just its own width). */
    widths: number[];
    files: Array<{ width: number; data: Buffer }>;
    /** `#rrggbb`, for a coloured box while the image loads. */
    dominantColor: string;
    /** A tiny blurred WebP as a data URI (a few hundred bytes). */
    placeholder: string;
}

/** The WebP sizes of a cleaned image, never upscaled. */
export async function makeVariants(data: Buffer): Promise<ImageVariants> {
    const metadata = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    const animated = (metadata.pages ?? 1) > 1;
    const smaller = IMAGE_WIDTHS.filter(candidate => candidate <= width);
    const widths = smaller.length ? smaller : [width];
    const files: ImageVariants['files'] = [];
    for (const target of widths) {
        const resize = (frames: boolean) =>
            sharp(data, {
                limitInputPixels: MAX_INPUT_PIXELS,
                animated: frames,
                pages: frames ? MAX_FRAMES : 1,
            })
                .resize({
                    width: target,
                    height: target * MAX_ASPECT,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 4 })
                .toBuffer();
        let out = await resize(animated);
        if (animated && out.byteLength > MAX_ANIMATED_VARIANT_BYTES) {
            out = await resize(false);
        }
        files.push({ width: target, data: out });
    }
    const { dominant } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }).stats();
    const hex = (value: number) => value.toString(16).padStart(2, '0');
    const tiny = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize({ width: 16, height: 16, fit: 'inside' })
        .blur(1)
        .webp({ quality: 40 })
        .toBuffer();
    return {
        width,
        height,
        widths,
        files,
        dominantColor: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
        placeholder: `data:image/webp;base64,${tiny.toString('base64')}`,
    };
}

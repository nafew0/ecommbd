import { createHash } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import {
    MAX_ANIMATED_FRAMES,
    MAX_ANIMATED_PIXELS,
    MAX_ANIMATED_VARIANT_BYTES,
    MAX_ASPECT_RATIO,
    MAX_INPUT_PIXELS,
    MAX_UPLOAD_BYTES,
    VARIANT_QUALITY,
    VARIANT_WIDTHS,
} from './constants';

/**
 * The image pipeline (roadmap phase 09): checking and cleaning an upload, then making its WebP
 * sizes. Plain functions around sharp, with no Vendure in them, so they are easy to test.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

/** Why an image was refused. Messages: `error.bd-image.<reason>` in i18n.ts. */
export type ImageRejection = 'too-large' | 'too-many-pixels' | 'heic' | 'unsupported' | 'unreadable';

export class ImageRejectedError extends Error {
    constructor(readonly reason: ImageRejection) {
        super(`Image rejected: ${reason}`);
        this.name = 'ImageRejectedError';
    }
}

export interface CleanImage {
    /** The cleaned full-size image, in its own format, with no metadata. */
    data: Buffer;
    format: ImageFormat;
    width: number;
    /** Height of one frame. */
    height: number;
    /** More than one frame, kept as an animation. */
    animated: boolean;
}

/** Which of our formats sharp found, or why it isn't one. */
function formatOf(metadata: Metadata): ImageFormat {
    switch (metadata.format) {
        case 'jpeg':
        case 'png':
        case 'webp':
        case 'gif':
            return metadata.format;
        case 'heif':
            // HEIF holds both AVIF (AV1, decodable) and iPhone HEIC (HEVC, not in sharp's build).
            if (metadata.compression === 'av1') return 'avif';
            throw new ImageRejectedError('heic');
        default:
            throw new ImageRejectedError('unsupported');
    }
}

/** True when an animation is small enough to keep animated (otherwise its first frame is used). */
function keepsAnimation(width: number, frameHeight: number, frames: number): boolean {
    return frames > 1 && frames <= MAX_ANIMATED_FRAMES && width * frameHeight * frames <= MAX_ANIMATED_PIXELS;
}

/** Reads an image's header and refuses what we don't accept, before decoding any pixels. */
async function inspect(input: Buffer): Promise<{ format: ImageFormat; animated: boolean }> {
    if (input.byteLength > MAX_UPLOAD_BYTES) throw new ImageRejectedError('too-large');
    let metadata: Metadata;
    try {
        metadata = await sharp(input, { limitInputPixels: false }).metadata();
    } catch {
        throw new ImageRejectedError('unreadable');
    }
    const format = formatOf(metadata);
    const width = metadata.width ?? 0;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    if (!width || !frameHeight) throw new ImageRejectedError('unreadable');
    if (width * frameHeight > MAX_INPUT_PIXELS) throw new ImageRejectedError('too-many-pixels');
    return { format, animated: keepsAnimation(width, frameHeight, metadata.pages ?? 1) };
}

function open(input: Buffer, animated: boolean): Sharp {
    // failOn 'warning' (sharp's default, spelled out): a truncated file fails instead of showing grey.
    return sharp(input, {
        animated,
        limitInputPixels: animated ? MAX_ANIMATED_PIXELS : MAX_INPUT_PIXELS,
        failOn: 'warning',
    });
}

/**
 * Checks an uploaded image and returns a clean copy: fully decoded (so a truncated or corrupt file
 * is refused), turned upright from its EXIF orientation, converted to sRGB, and re-encoded in its
 * own format with no metadata at all (sharp writes none unless asked), so GPS location and any
 * payload hidden in the file are gone. Throws `ImageRejectedError`.
 */
export async function cleanImage(input: Buffer): Promise<CleanImage> {
    const { format, animated } = await inspect(input);
    let image = open(input, animated).toColourspace('srgb');
    if (!animated) image = image.autoOrient();
    switch (format) {
        case 'jpeg':
            image = image.jpeg({ quality: 92 });
            break;
        case 'png':
            image = image.png();
            break;
        case 'webp':
            image = image.webp({ quality: 92 });
            break;
        case 'gif':
            image = image.gif();
            break;
        case 'avif':
            image = image.avif({ quality: 75, effort: 2 });
            break;
    }
    try {
        const { data, info } = await image.toBuffer({ resolveWithObject: true });
        return { data, format, width: info.width, height: info.pageHeight ?? info.height, animated };
    } catch {
        throw new ImageRejectedError('unreadable');
    }
}

/** The SHA-256 of a cleaned image: its identity, so the same picture is stored once. */
export function contentHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

export interface ImageVariant {
    /** The width asked for, which names the file (`<size>.webp`). */
    size: number;
    /** Actual size of the WebP (narrower than `size` for very tall images). */
    width: number;
    height: number;
    data: Buffer;
}

export interface ImageVariants {
    variants: ImageVariant[];
    width: number;
    height: number;
    animated: boolean;
    /** `#rrggbb`, for a coloured box while the image loads. */
    dominantColor: string;
    /** A tiny blurred WebP as a data URL (about 150 bytes). */
    placeholder: string;
}

/** The widths to make for an image this wide: never wider than the image itself. */
export function variantSizes(width: number): number[] {
    const sizes: number[] = VARIANT_WIDTHS.filter(size => size < width);
    if (width <= VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]) sizes.push(width);
    return sizes;
}

async function resizeAll(input: Buffer, sizes: number[], animated: boolean): Promise<ImageVariant[]> {
    return Promise.all(
        sizes.map(async size => {
            const { data, info } = await open(input, animated)
                .resize({
                    width: size,
                    height: size * MAX_ASPECT_RATIO,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .webp({ quality: VARIANT_QUALITY, effort: 4 })
                .toBuffer({ resolveWithObject: true });
            return { size, width: info.width, height: info.pageHeight ?? info.height, data };
        }),
    );
}

function toHex(value: number): string {
    return value.toString(16).padStart(2, '0');
}

/** Makes the WebP sizes, dominant colour and placeholder of a cleaned image. */
export async function makeVariants(clean: Buffer): Promise<ImageVariants> {
    const metadata = await sharp(clean, { limitInputPixels: false }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    let animated = keepsAnimation(width, height, metadata.pages ?? 1);
    const sizes = variantSizes(width);
    let variants = await resizeAll(clean, sizes, animated);
    if (
        animated &&
        variants.reduce((sum, variant) => sum + variant.data.byteLength, 0) > MAX_ANIMATED_VARIANT_BYTES
    ) {
        animated = false;
        variants = await resizeAll(clean, sizes, false);
    }
    const { dominant } = await open(clean, false).stats();
    const tiny = await open(clean, false)
        .resize({ width: 16, height: 16, fit: 'inside' })
        .webp({ quality: 40 })
        .toBuffer();
    return {
        variants,
        width,
        height,
        animated,
        dominantColor: `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`,
        placeholder: `data:image/webp;base64,${tiny.toString('base64')}`,
    };
}

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Image fixtures for the pipeline tests (roadmap phase 09), made with sharp when a test runs, so
 * the repository holds no binary fixtures except the HEIC (sharp can't write HEVC; it was made
 * with macOS `sips` from a plain green square).
 */

export const HEIC_PATH = path.join(__dirname, '../fixtures/images/photo.heic');

export function heic(): Buffer {
    return fs.readFileSync(HEIC_PATH);
}

/** A JPEG as a phone writes it: EXIF with a GPS position (Dhaka) and "rotate 90°" (orientation 6). */
export function gpsJpeg(width = 400, height = 300): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#c33' } })
        .jpeg()
        .withExif({
            IFD0: { Make: 'PhoneMaker', Model: 'Phone 1' },
            IFD3: {
                GPSLatitudeRef: 'N',
                GPSLatitude: '23/1 48/1 0/1',
                GPSLongitudeRef: 'E',
                GPSLongitude: '90/1 24/1 0/1',
            },
        })
        .withMetadata({ orientation: 6 })
        .toBuffer();
}

export function cmykJpeg(): Promise<Buffer> {
    return sharp({ create: { width: 300, height: 200, channels: 3, background: '#2a6' } })
        .toColourspace('cmyk')
        .jpeg()
        .toBuffer();
}

/** A transparent PNG with an opaque red dot in the middle. */
export function alphaPng(): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="80" fill="#e00"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

/** An animated GIF: red, green and blue frames. */
export async function animatedGif(width = 120, height = 90): Promise<Buffer> {
    const frames = await Promise.all(
        ['#f00', '#0f0', '#00f'].map(colour =>
            sharp({ create: { width, height, channels: 4, background: colour } })
                .png()
                .toBuffer(),
        ),
    );
    return sharp(frames, { join: { animated: true } })
        .gif({ delay: 100 })
        .toBuffer();
}

/** A decompression bomb: 50 megapixels of white in about 150 KB of PNG. */
export function bombPng(): Promise<Buffer> {
    return sharp({ create: { width: 8000, height: 6250, channels: 3, background: '#fff' } })
        .png({ compressionLevel: 9 })
        .toBuffer();
}

/** The first half of a JPEG. */
export async function truncatedJpeg(): Promise<Buffer> {
    const whole = await gpsJpeg(800, 600);
    return whole.subarray(0, Math.floor(whole.byteLength / 2));
}

export const SVG_WITH_SCRIPT = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(document.cookie)</script></svg>',
);

export function tinyPng(): Promise<Buffer> {
    return sharp({ create: { width: 100, height: 80, channels: 3, background: '#357' } })
        .png()
        .toBuffer();
}

/**
 * A stand-in for a 5 MB phone photo (4032×3024 JPEG): a scene of gradients and shapes with sensor-like
 * noise, so it compresses like a photo rather than a flat test card. Takes about 1.5 seconds.
 */
export async function phonePhoto(variation = 0): Promise<Buffer> {
    const width = 4032;
    const height = 3024;
    const circles = Array.from({ length: 40 }, (_, i) => {
        const n = i + variation * 7;
        return `<circle cx="${(n * 397) % width}" cy="${1200 + ((n * 211) % 1700)}" r="${80 + ((n * 37) % 220)}" fill="url(#r)" opacity="0.8"/>`;
    }).join('');
    const boxes = Array.from({ length: 30 }, (_, i) => {
        const n = i + variation * 5;
        return `<rect x="${(n * 631) % width}" y="${(n * 173) % 1800}" width="${100 + ((n * 53) % 400)}" height="${60 + ((n * 91) % 300)}" fill="hsl(${n * 37},50%,50%)" opacity="0.6"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
            <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fa8dc"/><stop offset="1" stop-color="#f6e7c1"/></linearGradient>
            <radialGradient id="r"><stop offset="0" stop-color="#e06666"/><stop offset="1" stop-color="#741b47"/></radialGradient>
        </defs>
        <rect width="100%" height="60%" fill="url(#s)"/><rect y="60%" width="100%" height="40%" fill="#6aa84f"/>
        ${circles}${boxes}
    </svg>`;
    const scene = await sharp(Buffer.from(svg)).png().toBuffer();
    const noise = await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: '#808080',
            noise: { type: 'gaussian', mean: 128, sigma: 40 },
        },
    })
        .blur(0.6)
        .png()
        .toBuffer();
    return sharp(scene)
        .composite([{ input: noise, blend: 'overlay' }])
        .jpeg({ quality: 92 })
        .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } })
        .toBuffer();
}

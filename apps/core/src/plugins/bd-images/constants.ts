/** Limits and sizes of the image pipeline (roadmap phase 09, docs/decisions.md). */

/** Largest upload accepted, in bytes (15 MB). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Largest picture accepted, in pixels (about 40 megapixels): stops decompression bombs. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** The only types accepted, checked by Vendure against the declared type, extension and bytes. */
export const PERMITTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Widths of the WebP sizes made for every image. */
export const VARIANT_WIDTHS = [160, 320, 480, 768, 1080, 1600] as const;

/** WebP quality of the sizes. */
export const VARIANT_QUALITY = 78;

/** A size is at most this many times as tall as it is wide (very tall pictures are scaled down). */
export const MAX_ASPECT_RATIO = 4;

/** Animated GIFs stay animated up to this many frames... */
export const MAX_ANIMATED_FRAMES = 200;

/** ...and this many pixels across all frames... */
export const MAX_ANIMATED_PIXELS = MAX_INPUT_PIXELS;

/** ...and when their sizes total less than this; otherwise only the first frame is used. */
export const MAX_ANIMATED_VARIANT_BYTES = 3 * 1024 * 1024;

/** Days the sizes of an image no asset uses are kept, so an accidental delete can be undone. */
export const DELETE_GRACE_DAYS = 7;

export const IMAGE_JOB_QUEUE = 'bd-image-variants';

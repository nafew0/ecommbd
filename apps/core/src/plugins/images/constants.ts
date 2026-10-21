export const loggerCtx = 'ImagesPlugin';
export const IMAGES_PLUGIN_OPTIONS = Symbol('IMAGES_PLUGIN_OPTIONS');

/** Image types accepted anywhere (checked by Vendure from the file's bytes, then by sharp). No SVG. */
export const PERMITTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Unused image sizes are deleted this long after they were first found unused. */
export const ORPHAN_GRACE_DAYS = 7;
export const ORPHAN_MARKER = '.orphaned';

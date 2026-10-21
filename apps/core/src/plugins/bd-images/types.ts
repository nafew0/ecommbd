import type { BdImage } from './bd-image.entity';

export const loggerCtx = 'BdImagesPlugin';

export const BD_IMAGES_OPTIONS = Symbol('BD_IMAGES_OPTIONS');

export interface BdImagesOptions {
    /** IMAGES_DIR: where the WebP sizes are written (`<dir>/<hash>/<width>.webp`). */
    dir: string;
    /** IMAGE_URL_PREFIX: where they are served from. Default `/img` (the core's own route). */
    urlPrefix?: string;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomAssetFields {
        bdImage?: BdImage | null;
    }
}

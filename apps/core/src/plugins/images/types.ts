export interface ImagesPluginOptions {
    /** Where the WebP sizes are written (IMAGES_DIR). Served at /img by the core, by Nginx in production. */
    imagesDir: string;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomAssetFields {
        contentHash?: string | null;
        /** The widths made, e.g. `160,320,480`. */
        imageWidths?: string | null;
        dominantColor?: string | null;
        placeholder?: string | null;
        /** pending, ready or failed. */
        imageStatus?: string;
        variantBytes?: number;
    }
}

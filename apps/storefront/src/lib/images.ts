import type { ResultOf } from './core';
import type { AssetFields } from './queries';
import { sameOriginAssetUrl } from './urls';

export type AssetData = ResultOf<typeof AssetFields>;

export interface ImageAttributes {
    src: string;
    srcset?: string;
    width?: number;
    height?: number;
}

/**
 * `<img>` attributes for an asset: phase 09's WebP sizes with `srcset` when they're ready, else
 * Vendure's preview. Width and height always come with it when known, so nothing jumps.
 */
export function imageAttributes(asset: AssetData, preferredWidth = 480): ImageAttributes {
    const image = asset.customFields?.bdImage;
    if (image?.status === 'ready' && image.variants.length) {
        const variant =
            image.variants.find(candidate => candidate.width >= preferredWidth) ??
            image.variants[image.variants.length - 1]!;
        return { src: variant.url, srcset: image.srcset, width: image.width, height: image.height };
    }
    return {
        src: `${sameOriginAssetUrl(asset.preview)}?w=${preferredWidth * 2}`,
        width: asset.width || undefined,
        height: asset.height || undefined,
    };
}

/** The largest version, for Open Graph and JSON-LD. */
export function largestImageUrl(asset: AssetData): string {
    const variants = asset.customFields?.bdImage?.variants ?? [];
    return asset.customFields?.bdImage?.status === 'ready' && variants.length
        ? variants[variants.length - 1]!.url
        : sameOriginAssetUrl(asset.preview);
}

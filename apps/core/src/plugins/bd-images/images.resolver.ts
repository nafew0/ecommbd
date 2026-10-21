import { Inject } from '@nestjs/common';
import { Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import type { BdImage } from './bd-image.entity';
import { BdImageService } from './image.service';
import { BD_IMAGES_OPTIONS, type BdImagesOptions } from './types';

/** `BdImage.variants` and `srcset`, with URLs under IMAGE_URL_PREFIX (default `/img`). */
@Resolver('BdImage')
export class BdImageResolver {
    private readonly prefix: string;

    constructor(@Inject(BD_IMAGES_OPTIONS) options: BdImagesOptions) {
        this.prefix = (options.urlPrefix ?? '/img').replace(/\/$/, '');
    }

    @ResolveField()
    variants(@Parent() image: BdImage) {
        if (image.status !== 'ready') return [];
        return (image.variants ?? []).map(variant => ({
            width: variant.width,
            height: variant.height,
            url: `${this.prefix}/${image.hash}/${variant.size}.webp`,
        }));
    }

    @ResolveField()
    srcset(@Parent() image: BdImage) {
        return this.variants(image)
            .map(variant => `${variant.url} ${variant.width}w`)
            .join(', ');
    }
}

@Resolver()
export class BdImageAdminResolver {
    constructor(private images: BdImageService) {}

    @Query()
    @Allow(Permission.ReadAsset)
    bdImageUsage(@Ctx() ctx: RequestContext) {
        return this.images.usage(ctx);
    }
}

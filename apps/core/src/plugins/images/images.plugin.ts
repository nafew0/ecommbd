import { type OnApplicationBootstrap } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    I18nService,
    Permission,
    PluginCommonModule,
    RequestContext,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import express from 'express';
import gql from 'graphql-tag';
import { IMAGES_PLUGIN_OPTIONS, PERMITTED_IMAGE_TYPES } from './constants';
import { assetImageCustomFields } from './custom-fields';
import { imageTranslations } from './i18n';
import { MAX_UPLOAD_BYTES } from './image-processing';
import { ImageVariantsService } from './image-variants.service';
import { SafeImageStorageStrategy } from './safe-storage';
import type { ImagesPluginOptions } from './types';

const adminApiExtensions = gql`
    type BdImageUsage {
        assets: Int!
        "Cleaned originals"
        sourceBytes: Float!
        "WebP sizes"
        variantBytes: Float!
        totalBytes: Float!
    }

    extend type Query {
        "Storage used by images, for plan limits (phase 39)"
        bdImageUsage: BdImageUsage!
    }
`;

@Resolver()
class ImagesAdminResolver {
    constructor(private variants: ImageVariantsService) {}

    @Query()
    @Allow(Permission.ReadAsset)
    bdImageUsage(@Ctx() ctx: RequestContext) {
        return this.variants.usage(ctx);
    }
}

/** `/img/<hash>/<width>.webp`: files only (no listing), cached for a year, plain 404 otherwise. */
function imageRouter(imagesDir: string) {
    const router = express.Router();
    router.use(
        express.static(imagesDir, {
            immutable: true,
            maxAge: '365d',
            index: false,
            redirect: false,
            dotfiles: 'deny',
            setHeaders: response => response.setHeader('X-Content-Type-Options', 'nosniff'),
        }),
    );
    router.use((_request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.status(404).type('text/plain').send('Not found');
    });
    return router;
}

const orphanTask = new ScheduledTask({
    id: 'bd-image-orphans',
    description: 'Mark image sizes no asset uses, and delete them 7 days later',
    schedule: '43 3 * * *',
    async execute({ injector }) {
        return injector.get(ImageVariantsService).removeOrphans();
    },
});

/**
 * Images (roadmap phase 09): every upload is checked and re-encoded before it's stored (type from
 * the bytes, pixel limit, rotation, no metadata or GPS, sRGB), then a job makes WebP sizes
 * (160–1600 px, never upscaled), a dominant colour and a tiny placeholder. Sizes are stored by
 * content hash and served at `/img/<hash>/<width>.webp` with a year's caching. Vendure's own
 * previews stay for the admin and the Dashboard.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: IMAGES_PLUGIN_OPTIONS, useFactory: () => ImagesPlugin.options },
        ImageVariantsService,
    ],
    exports: [ImageVariantsService],
    adminApiExtensions: { schema: adminApiExtensions, resolvers: [ImagesAdminResolver] },
    configuration: config => {
        const { assetOptions } = config;
        assetOptions.permittedFileTypes = PERMITTED_IMAGE_TYPES;
        assetOptions.uploadMaxFileSize = MAX_UPLOAD_BYTES;
        assetOptions.assetStorageStrategy = new SafeImageStorageStrategy(assetOptions.assetStorageStrategy);
        config.customFields.Asset = [...(config.customFields.Asset ?? []), ...assetImageCustomFields];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), orphanTask];
        config.apiOptions.middleware.push({
            route: 'img',
            handler: imageRouter(ImagesPlugin.options.imagesDir),
        });
        return config;
    },
    compatibility: '^3.8.0',
})
export class ImagesPlugin implements OnApplicationBootstrap {
    static options: ImagesPluginOptions;

    static init(options: ImagesPluginOptions): Type<ImagesPlugin> {
        ImagesPlugin.options = options;
        return ImagesPlugin;
    }

    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', imageTranslations.en);
        this.i18n.addTranslation('bn', imageTranslations.bn);
    }
}

import { type MiddlewareConsumer, type NestModule, type OnApplicationBootstrap } from '@nestjs/common';
import { HashedAssetNamingStrategy } from '@vendure/asset-server-plugin';
import {
    AssetEvent,
    EventBus,
    I18nService,
    Logger,
    PluginCommonModule,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import { filter } from 'rxjs/operators';
import { BdImage } from './bd-image.entity';
import { MAX_UPLOAD_BYTES, PERMITTED_IMAGE_TYPES } from './constants';
import { assetImageCustomFields } from './custom-fields';
import { imageTranslations } from './i18n';
import { createImageRouter } from './image-files';
import { BdImageService } from './image.service';
import { imageAdminApiExtensions, imageShopApiExtensions } from './images.api';
import { BdImageAdminResolver, BdImageResolver } from './images.resolver';
import { CleanImageStorageStrategy } from './storage';
import { BD_IMAGES_OPTIONS, type BdImagesOptions, loggerCtx } from './types';

/** Hourly: deletes the WebP sizes of images no asset has used for 7 days. */
export const imageSweepTask = new ScheduledTask({
    id: 'bd-image-sweep',
    description: 'Delete WebP sizes no asset has used for 7 days',
    schedule: '41 * * * *',
    async execute({ injector }) {
        return injector.get(BdImageService).sweep();
    },
});

/**
 * Images (roadmap phase 09): every upload is checked and cleaned before it is stored (type from
 * the file's bytes, 15 MB, 40 megapixels, metadata and GPS removed, re-encoded), then a worker job
 * makes WebP sizes for the storefront, served at `/img`. Vendure's asset server stays for the
 * Dashboard and the admin's previews. See docs/decisions.md.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdImage],
    providers: [BdImageService, { provide: BD_IMAGES_OPTIONS, useFactory: () => BdImagesPlugin.options }],
    shopApiExtensions: { schema: imageShopApiExtensions, resolvers: [BdImageResolver] },
    adminApiExtensions: {
        schema: imageAdminApiExtensions,
        resolvers: [BdImageResolver, BdImageAdminResolver],
    },
    configuration: config => {
        config.assetOptions.permittedFileTypes = PERMITTED_IMAGE_TYPES;
        config.assetOptions.uploadMaxFileSize = MAX_UPLOAD_BYTES;
        // `source/…` and `preview/…` names, so the storage wrapper knows which files are uploads.
        config.assetOptions.assetNamingStrategy = new HashedAssetNamingStrategy();
        config.assetOptions.assetStorageStrategy = new CleanImageStorageStrategy(
            config.assetOptions.assetStorageStrategy,
        );
        config.customFields.Asset = [...(config.customFields.Asset ?? []), ...assetImageCustomFields];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), imageSweepTask];
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdImagesPlugin implements NestModule, OnApplicationBootstrap {
    static options: BdImagesOptions;

    static init(options: BdImagesOptions): Type<BdImagesPlugin> {
        this.options = options;
        return BdImagesPlugin;
    }

    constructor(
        private i18n: I18nService,
        private eventBus: EventBus,
        private images: BdImageService,
    ) {}

    configure(consumer: MiddlewareConsumer) {
        consumer.apply(createImageRouter(BdImagesPlugin.options.dir)).forRoutes('img');
    }

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', imageTranslations.en);
        this.i18n.addTranslation('bn', imageTranslations.bn);
        // Published after the upload's transaction commits, so the worker finds the asset.
        this.eventBus
            .ofType(AssetEvent)
            .pipe(filter(event => event.type === 'created'))
            .subscribe(event => {
                this.images.enqueue(event.entity.id).catch((error: unknown) => {
                    Logger.error(
                        `Could not queue WebP sizes for asset ${event.entity.id}`,
                        loggerCtx,
                        String(error),
                    );
                });
            });
    }
}

import { type OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
    CollectionEvent,
    CollectionTranslation,
    EventBus,
    type ID,
    Logger,
    PluginCommonModule,
    ProductEvent,
    ProductTranslation,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { merge } from 'rxjs';
import { registerStoreDefaults } from '../bd-core';
import { manageContentPermission } from './constants';
import { contentAdminApiExtensions, contentShopApiExtensions } from './content.api';
import { ContentAdminResolver, ContentShopResolver } from './content.resolver';
import { contentMenusStep, contentPermissionsStep, slugBackfillStep } from './content-defaults';
import { seoCustomFields } from './custom-fields';
import { DescriptionSanitizerInterceptor } from './description.interceptor';
import { BdPage, BdPageTranslation, BdSlug, type SlugEntityType } from './entities';
import { MenuService } from './menu.service';
import { PageService } from './page.service';
import { SlugHistoryService } from './slug.service';
import './types';

registerStoreDefaults(contentPermissionsStep, contentMenusStep, slugBackfillStep);

/**
 * Storefront content (roadmap phase 12): simple pages, header and footer menus, slug history
 * (old URLs redirect, deleted products answer 410), SEO fields on products and categories, and
 * sanitized descriptions. Edited in our merchant admin with the ManageContent permission.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdPage, BdPageTranslation, BdSlug],
    providers: [
        PageService,
        MenuService,
        SlugHistoryService,
        { provide: APP_INTERCEPTOR, useClass: DescriptionSanitizerInterceptor },
    ],
    shopApiExtensions: { schema: contentShopApiExtensions, resolvers: [ContentShopResolver] },
    adminApiExtensions: { schema: contentAdminApiExtensions, resolvers: [ContentAdminResolver] },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            manageContentPermission,
        ];
        config.customFields.Product = [...(config.customFields.Product ?? []), ...seoCustomFields];
        config.customFields.Collection = [...(config.customFields.Collection ?? []), ...seoCustomFields];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            // Written only by updateBdMenus; the Shop API reads them through MenuService.
            bdContent: [
                {
                    name: 'menus',
                    readonly: true,
                    requiresPermission: {
                        read: manageContentPermission.Permission,
                        write: manageContentPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdContentPlugin implements OnApplicationBootstrap {
    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
        private slugs: SlugHistoryService,
    ) {}

    onApplicationBootstrap() {
        // Events arrive after the change has committed; the slugs are read back from the database.
        merge(this.eventBus.ofType(ProductEvent), this.eventBus.ofType(CollectionEvent)).subscribe(event => {
            const type: SlugEntityType = event instanceof ProductEvent ? 'product' : 'collection';
            this.recordSlugs(type, event.entity.id, event.type === 'deleted').catch((error: unknown) =>
                Logger.error(
                    `Could not record the slugs of ${type} ${event.entity.id}`,
                    'BdContentPlugin',
                    String(error),
                ),
            );
        });
    }

    private async recordSlugs(type: SlugEntityType, id: ID, deleted: boolean) {
        if (deleted) {
            await this.slugs.markDeleted(type, id);
            return;
        }
        const translations = await this.connection.rawConnection
            .getRepository(type === 'product' ? ProductTranslation : CollectionTranslation)
            .find({ where: { base: { id } } });
        await this.slugs.record(type, id, translations);
    }
}

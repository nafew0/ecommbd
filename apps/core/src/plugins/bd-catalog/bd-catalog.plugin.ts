import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    I18nService,
    Logger,
    Permission,
    PluginCommonModule,
    RequestContextService,
    ScheduledTask,
    VendurePlugin,
} from '@vendure/core';
import { ShippingBdPlugin } from '../shipping-bd';
import { catalogAdminApiExtensions, catalogShopApiExtensions } from './catalog.api';
import { CatalogAdminResolver, CatalogShopProductResolver } from './catalog.resolver';
import { CatalogService } from './catalog.service';
import { categoryCollectionFilter } from './category-filter';
import {
    collectionCatalogCustomFields,
    productCatalogCustomFields,
    variantCatalogCustomFields,
} from './custom-fields';
import { catalogTranslations } from './i18n';
import { ProductFormService } from './product-form.service';
import { ProductSettingsService } from './product-settings.service';
import { ProductStatusService } from './product-status.service';
import { BdStockAdjustment } from './stock-adjustment.entity';
import { stockGuardProcess } from './stock-guard';
import { StockService } from './stock.service';
import './types';

/** Daily: products in the trash for more than 30 days are deleted (phase 55). */
export const emptyProductTrashTask = new ScheduledTask({
    id: 'bd-empty-product-trash',
    description: 'Delete products that have been in the trash for 30 days',
    schedule: '17 3 * * *',
    async execute({ injector }) {
        const ctx = await injector.get(RequestContextService).create({ apiType: 'admin' });
        const removed = await injector.get(ProductStatusService).emptyOld(ctx);
        if (removed) Logger.info(`Emptied ${removed} product(s) from the trash`, 'BdCatalogPlugin');
        return { removed };
    },
});

/**
 * Products, categories and stock for the merchant admin (roadmap phase 05):
 * - the one-page product form (Bangla and English, gallery, feedback images, YouTube, Featured
 *   and New, delivery for the product, one variation dimension with price, stock and image each);
 * - categories (collections filled by the product's category);
 * - stock adjustments with a reason, pre-orders (backorders) per variant;
 * - no overselling: stock is locked and re-checked when an order is placed.
 */
@VendurePlugin({
    imports: [PluginCommonModule, ShippingBdPlugin],
    entities: [BdStockAdjustment],
    providers: [CatalogService, ProductFormService, StockService, ProductSettingsService, ProductStatusService],
    exports: [StockService, ProductSettingsService],
    adminApiExtensions: { schema: catalogAdminApiExtensions, resolvers: [CatalogAdminResolver] },
    shopApiExtensions: { schema: catalogShopApiExtensions, resolvers: [CatalogShopProductResolver] },
    configuration: config => {
        config.customFields.Product = [...(config.customFields.Product ?? []), ...productCatalogCustomFields];
        config.customFields.ProductVariant = [
            ...(config.customFields.ProductVariant ?? []),
            ...variantCatalogCustomFields,
        ];
        config.customFields.Collection = [
            ...(config.customFields.Collection ?? []),
            ...collectionCatalogCustomFields,
        ];
        config.catalogOptions.collectionFilters = [
            ...config.catalogOptions.collectionFilters,
            categoryCollectionFilter,
        ];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), stockGuardProcess];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), emptyProductTrashTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdCatalog: [
                {
                    name: 'productSettings',
                    readonly: true,
                    requiresPermission: { read: Permission.ReadCatalog, write: Permission.UpdateCatalog },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdCatalogPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', catalogTranslations.en);
        this.i18n.addTranslation('bn', catalogTranslations.bn);
    }
}

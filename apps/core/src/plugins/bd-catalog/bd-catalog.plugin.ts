import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { ShippingBdPlugin } from '../shipping-bd';
import { catalogAdminApiExtensions } from './catalog.api';
import { CatalogAdminResolver } from './catalog.resolver';
import { CatalogService } from './catalog.service';
import { categoryCollectionFilter } from './category-filter';
import {
    collectionCatalogCustomFields,
    productCatalogCustomFields,
    variantCatalogCustomFields,
} from './custom-fields';
import { catalogTranslations } from './i18n';
import { ProductFormService } from './product-form.service';
import { BdStockAdjustment } from './stock-adjustment.entity';
import { stockGuardProcess } from './stock-guard';
import { StockService } from './stock.service';
import './types';

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
    providers: [CatalogService, ProductFormService, StockService],
    exports: [StockService],
    adminApiExtensions: { schema: catalogAdminApiExtensions, resolvers: [CatalogAdminResolver] },
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

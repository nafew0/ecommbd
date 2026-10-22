import { type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { registerLayoutOwner } from '../bd-sections';
import { orderAttributionCustomFields } from './custom-fields';
import { BdSalesPage } from './entities';
import { salesPageOfferAction, salesPageOfferCondition } from './offer-promotion';
import {
    BD_SALES_PAGES_PLUGIN_OPTIONS,
    type BdSalesPagesPluginOptions,
    SalesPageService,
} from './sales-page.service';
import { salesPagesAdminApiExtensions, salesPagesShopApiExtensions } from './sales-pages.api';
import {
    OrderAttributionResolver,
    SalesPagesAdminResolver,
    SalesPagesShopResolver,
} from './sales-pages.resolver';
import { salesPageOfferStep } from './sales-pages-defaults';

registerStoreDefaults(salesPageOfferStep);

/**
 * Sales pages (roadmap phase 16): ad landing pages at `/s/<slug>/`, made from twelve Bangla
 * templates and a product, edited in phase 15's page editor, with packs and an add-on priced by the
 * automatic "Sales page offer" promotion, and an order form of their own. Every order records the
 * sales page and the ad or link it came from (Order custom fields). Edited with EditStorefront.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdSalesPage],
    providers: [
        SalesPageService,
        { provide: BD_SALES_PAGES_PLUGIN_OPTIONS, useFactory: () => BdSalesPagesPlugin.options },
    ],
    shopApiExtensions: { schema: salesPagesShopApiExtensions, resolvers: [SalesPagesShopResolver] },
    adminApiExtensions: {
        schema: salesPagesAdminApiExtensions,
        resolvers: [SalesPagesAdminResolver, OrderAttributionResolver],
    },
    configuration: config => {
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderAttributionCustomFields];
        config.promotionOptions.promotionConditions = [
            ...(config.promotionOptions.promotionConditions ?? []),
            salesPageOfferCondition,
        ];
        config.promotionOptions.promotionActions = [
            ...(config.promotionOptions.promotionActions ?? []),
            salesPageOfferAction,
        ];
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdSalesPagesPlugin implements OnApplicationBootstrap {
    static options: BdSalesPagesPluginOptions = {};

    constructor(private moduleRef: ModuleRef) {}

    static init(options: BdSalesPagesPluginOptions) {
        this.options = options;
        return BdSalesPagesPlugin;
    }

    /** The page editor names sales page layouts and previews them at their address. */
    onApplicationBootstrap() {
        const pages = this.moduleRef.get(SalesPageService);
        registerLayoutOwner('landing', {
            title: (ctx, id) => pages.ownerTitle(ctx, id),
            path: (ctx, id) => pages.ownerPath(ctx, id),
        });
    }
}

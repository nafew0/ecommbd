import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { brandFacetStep } from './brand-defaults';
import { BrandService } from './brand.service';
import { brandAdminApiExtensions, brandShopApiExtensions } from './brands.api';
import { BrandAdminResolver, BrandShopResolver } from './brands.resolver';
import { facetValueBrandCustomFields } from './custom-fields';
import { brandTranslations } from './i18n';
import './types';

registerStoreDefaults(brandFacetStep);

/**
 * Brands (roadmap phase 55): values of a public `brand` facet with a logo and a description.
 * Search already turns public facets into filters, so the storefront gets a brand filter on
 * category and search pages; brand pages use the same search. Deleting a brand takes it off its
 * products, which keep working with no brand.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [BrandService],
    exports: [BrandService],
    adminApiExtensions: { schema: brandAdminApiExtensions, resolvers: [BrandAdminResolver] },
    shopApiExtensions: { schema: brandShopApiExtensions, resolvers: [BrandShopResolver] },
    configuration: config => {
        config.customFields.FacetValue = [...(config.customFields.FacetValue ?? []), ...facetValueBrandCustomFields];
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdBrandsPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', brandTranslations.en);
        this.i18n.addTranslation('bn', brandTranslations.bn);
    }
}

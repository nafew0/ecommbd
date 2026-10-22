import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { manageContentPermission } from '../bd-content/constants';
import { BD_SEARCH_PLUGIN_OPTIONS, type BdSearchPluginOptions } from './constants';
import { BdSearchMiss } from './entities';
import { searchTranslations } from './i18n';
import { SearchRateLimiter } from './rate-limiter';
import { searchAdminApiExtensions, searchShopApiExtensions } from './search.api';
import { SearchAdminResolver, SearchShopResolver } from './search.resolver';
import { BdSearchService } from './search.service';
import { searchMissCleanupTask, searchSynonymsStep } from './search-defaults';

registerStoreDefaults(searchSynonymsStep);

/**
 * Catalog search and filters (roadmap phase 13): `bdSearch` and `bdSearchSuggestions` for the
 * storefront, with Bangla/English matching, typos, synonyms and per-variation filters; synonyms and
 * searches with no results for merchants (Online store → Search, ManageContent). Reads the index
 * that Vendure's DefaultSearchPlugin keeps, so that plugin must be installed too.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdSearchMiss],
    providers: [
        BdSearchService,
        SearchRateLimiter,
        { provide: BD_SEARCH_PLUGIN_OPTIONS, useFactory: () => BdSearchPlugin.options },
    ],
    shopApiExtensions: { schema: searchShopApiExtensions, resolvers: [SearchShopResolver] },
    adminApiExtensions: { schema: searchAdminApiExtensions, resolvers: [SearchAdminResolver] },
    configuration: config => {
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            // Written only by updateBdSearchSettings; the Shop API reads them through BdSearchService.
            bdSearch: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: manageContentPermission.Permission,
                        write: manageContentPermission.Permission,
                    },
                },
            ],
        };
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), searchMissCleanupTask];
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdSearchPlugin implements OnApplicationBootstrap {
    static options: BdSearchPluginOptions;

    static init(options: BdSearchPluginOptions) {
        this.options = options;
        return BdSearchPlugin;
    }

    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', searchTranslations.en);
        this.i18n.addTranslation('bn', searchTranslations.bn);
    }
}

import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import {
    BD_SECTIONS_PLUGIN_OPTIONS,
    type BdSectionsPluginOptions,
    editStorefrontPermission,
} from './constants';
import { BdPageLayout, BdPageLayoutVersion, BdSavedSection } from './entities';
import { LayoutService } from './layout.service';
import { sectionsAdminApiExtensions, sectionsShopApiExtensions } from './sections.api';
import { SectionsAdminResolver, SectionsShopResolver } from './sections.resolver';
import { storefrontPermissionsStep } from './sections-defaults';
import { StorefrontPurger } from './storefront-purger';
import { ThemeService } from './theme.service';

registerStoreDefaults(storefrontPermissionsStep);

/**
 * Sections, themes and the page editor (roadmap phase 15): layouts of the home page, the product
 * page template and phase 12's pages, with autosaved drafts, publishing with a version stamp,
 * history and preview links; saved sections; theme settings. Edited in our merchant admin with
 * the EditStorefront permission; section definitions live in `@ecommbd/sections`.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdPageLayout, BdPageLayoutVersion, BdSavedSection],
    providers: [
        LayoutService,
        ThemeService,
        StorefrontPurger,
        { provide: BD_SECTIONS_PLUGIN_OPTIONS, useFactory: () => BdSectionsPlugin.options },
    ],
    shopApiExtensions: { schema: sectionsShopApiExtensions, resolvers: [SectionsShopResolver] },
    adminApiExtensions: { schema: sectionsAdminApiExtensions, resolvers: [SectionsAdminResolver] },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            editStorefrontPermission,
        ];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            // Written only by updateBdThemeSettings; the Shop API reads it through ThemeService.
            bdSections: [
                {
                    name: 'theme',
                    readonly: true,
                    requiresPermission: {
                        read: editStorefrontPermission.Permission,
                        write: editStorefrontPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdSectionsPlugin {
    static options: BdSectionsPluginOptions;

    static init(options: BdSectionsPluginOptions) {
        this.options = options;
        return BdSectionsPlugin;
    }
}

import { type OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
    I18nService,
    Permission,
    PluginCommonModule,
    ProcessContext,
    SettingsStoreScopes,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import { addressCustomFields } from './address/address-fields';
import { BdAddressInterceptor } from './address/address.interceptor';
import { BD_CORE_PLUGIN_OPTIONS, updateStoreSettingsPermission } from './constants';
import { BdGeoController } from './geo/geo.controller';
import { geoApiExtensions } from './geo/geo.api';
import { BdGeoResolver } from './geo/geo.resolver';
import { errorTranslations } from './i18n';
import { settingsAdminApiExtensions, settingsShopApiExtensions } from './settings/settings.api';
import {
    BdStoreSettingsAdminResolver,
    BdStoreSettingsShopResolver,
} from './settings/store-settings.resolver';
import { StoreSettingsService } from './settings/store-settings.service';
import { StoreDefaultsService } from './store-defaults/store-defaults.service';
import type { BdCorePluginOptions } from './types';

/**
 * Bangladesh basics every store needs (roadmap phase 02):
 * - place lists: `bdDistricts` / `bdThanas` in the Shop and Admin APIs, and cacheable GET routes;
 * - address fields (district, thana, area, landmark, alternate phone) with server-side checks;
 * - store defaults on first start (BDT, Bangla and English, Bangladesh, 0% tax, staff roles),
 *   extensible by later plugins through `registerStoreDefaults`;
 * - store settings (profile, policies, locale) with a public/private split and change history.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: BD_CORE_PLUGIN_OPTIONS, useFactory: () => BdCorePlugin.options },
        { provide: APP_INTERCEPTOR, useClass: BdAddressInterceptor },
        StoreDefaultsService,
        StoreSettingsService,
    ],
    controllers: [BdGeoController],
    shopApiExtensions: {
        schema: gql`
            ${geoApiExtensions}
            ${settingsShopApiExtensions}
        `,
        resolvers: [BdGeoResolver, BdStoreSettingsShopResolver],
    },
    adminApiExtensions: {
        schema: gql`
            ${geoApiExtensions}
            ${settingsAdminApiExtensions}
        `,
        resolvers: [BdGeoResolver, BdStoreSettingsAdminResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            updateStoreSettingsPermission,
        ];
        config.customFields.Address = [...(config.customFields.Address ?? []), ...addressCustomFields];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdStore: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
                { name: 'history', readonly: true, requiresPermission: Permission.ReadSettings },
                { name: 'defaults', readonly: true, requiresPermission: Permission.SuperAdmin },
            ],
            bdAdmin: [
                {
                    name: 'language',
                    scope: SettingsStoreScopes.user,
                    validate: value =>
                        value === 'bn' || value === 'en' ? undefined : 'Must be "bn" or "en"',
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdCorePlugin implements OnApplicationBootstrap {
    static options: BdCorePluginOptions = { defaultLanguage: 'bn' };

    static init(options: BdCorePluginOptions): Type<BdCorePlugin> {
        this.options = options;
        return BdCorePlugin;
    }

    constructor(
        private i18n: I18nService,
        private processContext: ProcessContext,
        private storeDefaults: StoreDefaultsService,
    ) {}

    async onApplicationBootstrap() {
        this.i18n.addTranslation('en', errorTranslations.en);
        this.i18n.addTranslation('bn', errorTranslations.bn);
        if (this.processContext.isServer && BdCorePlugin.options.initializeOnBootstrap !== false) {
            await this.storeDefaults.run();
        }
    }
}

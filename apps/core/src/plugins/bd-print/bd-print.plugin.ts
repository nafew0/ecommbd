import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, Permission, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults, StoreSettingsService, updateStoreSettingsPermission } from '../bd-core';
import { printOrdersPermission } from './constants';
import { orderPrintCustomFields } from './custom-fields';
import { printTranslations } from './i18n';
import { printAdminApiExtensions } from './print.api';
import { OrderPrintInfoResolver, PrintAdminResolver } from './print.resolver';
import { PrintService } from './print.service';
import { printPermissionsStep } from './print-defaults';
import { PrintSettingsService } from './print-settings.service';

registerStoreDefaults(printPermissionsStep);

/**
 * Invoices, packing slips, receipts and courier stickers (roadmap phase 06). The print views are
 * pages of the merchant admin, printed by the browser; this plugin gives them their data (with the
 * PrintOrders permission), remembers what was printed, and keeps the print settings.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [PrintSettingsService, PrintService, StoreSettingsService],
    adminApiExtensions: {
        schema: printAdminApiExtensions,
        resolvers: [PrintAdminResolver, OrderPrintInfoResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            printOrdersPermission,
        ];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderPrintCustomFields];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdPrint: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdPrintPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', printTranslations.en);
        this.i18n.addTranslation('bn', printTranslations.bn);
    }
}

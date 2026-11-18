import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { BdCatalogPlugin } from '../bd-catalog';
import { BdCorePlugin, registerStoreDefaults, updateStoreSettingsPermission } from '../bd-core';
import { readCostPermission } from '../bd-cost';
import { managePurchasePermission, readPurchasePermission } from './constants';
import {
    BdPurchase,
    BdPurchaseLine,
    BdPurchaseReturn,
    BdPurchaseReturnLine,
    BdSupplier,
    BdSupplierPayment,
} from './entities';
import { purchaseTranslations } from './i18n';
import { purchasePermissionsStep } from './purchase-defaults';
import { purchaseAdminApiExtensions } from './purchase.api';
import { PurchaseAdminResolver } from './purchase.resolver';
import { PurchaseService } from './purchase.service';
import { PurchaseSettingsService } from './purchase-settings.service';

registerStoreDefaults(purchasePermissionsStep);

/**
 * Purchases and suppliers (roadmap phase 52):
 * - a supplier, with the balance owed worked out from purchases, returns and payments;
 * - a purchase (draft, ordered, partly received, received) whose receiving adds stock
 *   through the phase 05 adjustment (reason "purchase") and updates the variation's cost;
 * - a return, which takes that stock and cost back;
 * - a payment recorded against the supplier. Accounts that hold the money come in phase 53.
 */
@VendurePlugin({
    imports: [PluginCommonModule, BdCatalogPlugin, BdCorePlugin],
    entities: [BdSupplier, BdPurchase, BdPurchaseLine, BdPurchaseReturn, BdPurchaseReturnLine, BdSupplierPayment],
    providers: [PurchaseSettingsService, PurchaseService],
    adminApiExtensions: {
        schema: purchaseAdminApiExtensions,
        resolvers: [PurchaseAdminResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            readPurchasePermission,
            managePurchasePermission,
        ];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdPurchases: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: readCostPermission.Permission,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdPurchasesPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', purchaseTranslations.en);
        this.i18n.addTranslation('bn', purchaseTranslations.bn);
    }
}

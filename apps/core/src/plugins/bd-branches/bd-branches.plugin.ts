import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { BdCatalogPlugin } from '../bd-catalog';
import { BdCorePlugin, registerStoreDefaults } from '../bd-core';
import { branchSetupStep } from './branch-defaults';
import { branchAdminApiExtensions } from './branch.api';
import { BranchAdminResolver } from './branch.resolver';
import { BranchService } from './branch.service';
import { BranchSettingsService } from './branch-settings.service';
import { manageBranchPermission, readBranchPermission } from './constants';
import { orderBranchFields, stockLocationBranchFields } from './custom-fields';
import { BdStockTransfer, BdStockTransferLine } from './entities';
import { branchTranslations } from './i18n';
import { branchOrderProcess } from './order-process';
import { BranchStockLocationStrategy } from './stock-strategy';
import { TransferService } from './transfer.service';
import './types';

registerStoreDefaults(branchSetupStep);

/**
 * Branches and stock transfers (roadmap phase 54):
 * - a branch is Vendure's stock location, with an address and whether it sells online;
 * - purchases receive into a chosen branch; orders allocate the shipping branch first;
 * - a transfer leaves the source immediately and arrives when the other branch receives it.
 * Existing stock is not moved: a store's original location stays the default.
 */
@VendurePlugin({
    imports: [PluginCommonModule, BdCatalogPlugin, BdCorePlugin],
    entities: [BdStockTransfer, BdStockTransferLine],
    providers: [BranchSettingsService, BranchService, TransferService],
    exports: [BranchService],
    adminApiExtensions: {
        schema: branchAdminApiExtensions,
        resolvers: [BranchAdminResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            readBranchPermission,
            manageBranchPermission,
        ];
        config.customFields.StockLocation = [
            ...(config.customFields.StockLocation ?? []),
            ...stockLocationBranchFields,
        ];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderBranchFields];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), branchOrderProcess()];
        config.catalogOptions.stockLocationStrategy = new BranchStockLocationStrategy();
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdBranches: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: readBranchPermission.Permission,
                        write: manageBranchPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdBranchesPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', branchTranslations.en);
        this.i18n.addTranslation('bn', branchTranslations.bn);
    }
}

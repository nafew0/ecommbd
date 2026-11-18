import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { BdCorePlugin, registerStoreDefaults } from '../bd-core';
import { BdCostPlugin } from '../bd-cost';
import { accountsPermissionsStep } from './account-defaults';
import { accountAdminApiExtensions } from './account.api';
import { AccountAdminResolver } from './account.resolver';
import { AccountService } from './account.service';
import { AccountSettingsService } from './account-settings.service';
import { manageAccountsPermission } from './constants';
import { BdAccount, BdExpense, BdExpenseHead, BdTransaction } from './entities';
import { accountTranslations } from './i18n';
import { PostingService } from './posting.service';
import { ReportService } from './report.service';

registerStoreDefaults(accountsPermissionsStep);

/**
 * Accounts, expenses and profit and loss (roadmap phase 53):
 * - cash, bank, wallet and courier-balance accounts, with a calculated balance;
 * - expenses under editable heads, and a receipt photo;
 * - a ledger of orders, purchases, expenses, transfers and manual entries;
 * - a profit and loss report for any Dhaka date range. Phase 41's report list is not built,
 *   so the report is its own screen.
 */
@VendurePlugin({
    imports: [PluginCommonModule, BdCorePlugin, BdCostPlugin],
    entities: [BdAccount, BdExpenseHead, BdExpense, BdTransaction],
    providers: [AccountSettingsService, AccountService, ReportService, PostingService],
    adminApiExtensions: {
        schema: accountAdminApiExtensions,
        resolvers: [AccountAdminResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            manageAccountsPermission,
        ];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdAccounts: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: manageAccountsPermission.Permission,
                        write: manageAccountsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdAccountsPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', accountTranslations.en);
        this.i18n.addTranslation('bn', accountTranslations.bn);
    }
}

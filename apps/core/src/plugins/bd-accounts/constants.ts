import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdAccountsPlugin';

export const ACCOUNT_SETTINGS_KEY = 'bdAccounts.settings';

/** See and change accounts, expenses and the profit and loss report. Owner only, by default. */
export const manageAccountsPermission = new PermissionDefinition({
    name: 'ManageAccounts',
    description: 'See accounts, expenses and profit',
});

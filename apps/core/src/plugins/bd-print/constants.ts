import { PermissionDefinition } from '@vendure/core';

/** Keys in Vendure's settings store. */
export const PRINT_SETTINGS_KEY = 'bdPrint.settings';

export const printOrdersPermission = new PermissionDefinition({
    name: 'PrintOrders',
    description: 'Print invoices, packing slips, receipts and courier stickers',
});

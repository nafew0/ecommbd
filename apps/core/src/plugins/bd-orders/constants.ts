import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdOrdersPlugin';

/** Keys in Vendure's settings store. */
export const ORDER_SETTINGS_KEY = 'bdOrders.settings';

/** A staff member's claim on a New order ("Rahim is calling") lasts this long. */
export const CLAIM_MINUTES = 5;
/** The same customer ordering the same items within this window is a possible duplicate. */
export const DUPLICATE_WINDOW_MINUTES = 30;
/** Our order history entry for a call to the customer. */
export const CALL_ATTEMPT_HISTORY_TYPE = 'BD_CALL_ATTEMPT' as const;

export const confirmOrderPermission = new PermissionDefinition({
    name: 'ConfirmOrder',
    description: 'Confirm new orders and record calls to the customer',
});
export const cancelOrderPermission = new PermissionDefinition({
    name: 'CancelOrder',
    description: 'Cancel orders (with a reason)',
});
export const packOrderPermission = new PermissionDefinition({
    name: 'PackOrder',
    description: 'Mark orders as packed',
});
export const readSalesFiguresPermission = new PermissionDefinition({
    name: 'ReadSalesFigures',
    description: 'See sales totals on the dashboard',
});

export const ORDER_PERMISSIONS = [
    confirmOrderPermission,
    cancelOrderPermission,
    packOrderPermission,
    readSalesFiguresPermission,
];

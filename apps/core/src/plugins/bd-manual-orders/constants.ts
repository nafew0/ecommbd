import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdManualOrdersPlugin';

/** Order surcharge SKU of a discount staff gave (a negative surcharge). */
export const MANUAL_DISCOUNT_SKU = 'BD-MANUAL-DISCOUNT';

/** Order history entry for an edit: who, when, and before/after. */
export const ORDER_EDIT_HISTORY_TYPE = 'BD_ORDER_EDIT' as const;

/** Unfinished draft orders (e.g. from the Dashboard) are deleted after this many days. */
export const DRAFT_EXPIRY_DAYS = 7;

export const createManualOrderPermission = new PermissionDefinition({
    name: 'CreateManualOrder',
    description: 'Enter orders taken by phone, Messenger or WhatsApp',
});
export const editOrderPermission = new PermissionDefinition({
    name: 'EditOrder',
    description: 'Change items, address, delivery and discount of an order before it ships',
});
export const overridePricePermission = new PermissionDefinition({
    name: 'OverridePrice',
    description: 'Change a product’s price on an order',
});
export const applyManualDiscountPermission = new PermissionDefinition({
    name: 'ApplyManualDiscount',
    description: 'Give a discount on an order (up to 10% without UnlimitedDiscount)',
});
export const unlimitedDiscountPermission = new PermissionDefinition({
    name: 'UnlimitedDiscount',
    description: 'Give any discount on an order',
});

export const MANUAL_ORDER_PERMISSIONS = [
    createManualOrderPermission,
    editOrderPermission,
    overridePricePermission,
    applyManualDiscountPermission,
    unlimitedDiscountPermission,
];

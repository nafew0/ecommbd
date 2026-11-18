import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdPurchasesPlugin';

export const PURCHASE_SETTINGS_KEY = 'bdPurchases.settings';

export const PURCHASE_SEQUENCE = 'bd_purchase_number_seq';
export const RETURN_SEQUENCE = 'bd_purchase_return_number_seq';

/** Created by the migration. Test databases, built from entities, run the same statement. */
export const CREATE_PURCHASE_SEQUENCES_SQL = `
CREATE SEQUENCE IF NOT EXISTS "${PURCHASE_SEQUENCE}" START WITH 1001;
CREATE SEQUENCE IF NOT EXISTS "${RETURN_SEQUENCE}" START WITH 1001;
`;

/** See suppliers, purchases, returns and what is owed. The lines carry cost, so ReadCost is also required. */
export const readPurchasePermission = new PermissionDefinition({
    name: 'ReadPurchase',
    description: 'See suppliers and purchases',
});

/** Create and change purchases, receive stock, record returns and payments. */
export const managePurchasePermission = new PermissionDefinition({
    name: 'ManagePurchase',
    description: 'Record purchases, returns and supplier payments',
});

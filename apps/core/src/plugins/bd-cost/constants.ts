import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdCostPlugin';

/** Key in Vendure's settings store. */
export const COST_SETTINGS_KEY = 'bdCost.settings';

/** Column added for the order-line snapshot. Only this column is written, so other fields stay. */
export const ORDER_LINE_COST_COLUMN = 'customFieldsUnitcost';

export const readCostPermission = new PermissionDefinition({
    name: 'ReadCost',
    description: 'See product cost and order profit',
});

/** How many orders the list asks about at once. */
export const PROFIT_BATCH = 100;

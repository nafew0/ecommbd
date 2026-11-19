import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'BdBranchesPlugin';

export const BRANCH_SETTINGS_KEY = 'bdBranches.settings';

export const TRANSFER_SEQUENCE = 'bd_stock_transfer_number_seq';

/** Created by the migration. Test databases, built from entities, run the same statement. */
export const CREATE_TRANSFER_SEQUENCE_SQL = `
CREATE SEQUENCE IF NOT EXISTS "${TRANSFER_SEQUENCE}" START WITH 1001;
`;

/** See branches, per-branch stock, transfers, and which branch ships an order. */
export const readBranchPermission = new PermissionDefinition({
    name: 'ReadBranch',
    description: 'See branches, stock by branch and transfers',
});

/** Create and change branches, send and receive transfers, and set zone and courier defaults. */
export const manageBranchPermission = new PermissionDefinition({
    name: 'ManageBranch',
    description: 'Manage branches and stock transfers',
});

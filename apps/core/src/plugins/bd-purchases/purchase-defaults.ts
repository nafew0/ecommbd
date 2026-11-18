import { RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { managePurchasePermission, readPurchasePermission } from './constants';

/** Owner and manager buy stock. Order staff do not see what the shop pays. */
const PURCHASE_ROLES = ['owner', 'manager'];

/**
 * Store defaults (phase 52): ReadPurchase and ManagePurchase on the owner and manager.
 * A new step, so stores that already ran the roles step get it too.
 */
export const purchasePermissionsStep: StoreDefaultsStep = {
    id: 'purchase-permissions',
    description: 'ReadPurchase and ManagePurchase on the owner and manager roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const permissions = [readPurchasePermission.Permission, managePurchasePermission.Permission];
        const notes: string[] = [];
        for (const role of roles.items) {
            if (!PURCHASE_ROLES.includes(role.code)) continue;
            const missing = permissions.filter(permission => !role.permissions.includes(permission as never));
            if (missing.length === 0) continue;
            await roleService.update(ctx, {
                id: role.id,
                permissions: [...role.permissions, ...missing] as never,
            });
            notes.push(`${role.code}: ${missing.join(', ')}`);
        }
        return notes;
    },
};

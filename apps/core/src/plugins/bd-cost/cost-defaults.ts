import { RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { readCostPermission } from './constants';

/** Owner and manager see cost. Order staff, packers and marketing do not. */
const COST_ROLES = ['owner', 'manager'];

/**
 * Store defaults (phase 51): ReadCost on the owner and manager roles. A new step, so stores that
 * already ran the roles step get it too. Roles the merchant deleted are left alone, and a role
 * they edited keeps every other permission.
 */
export const costPermissionsStep: StoreDefaultsStep = {
    id: 'cost-permissions',
    description: 'ReadCost on the owner and manager roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const permission = readCostPermission.Permission;
        const notes: string[] = [];
        for (const role of roles.items) {
            if (COST_ROLES.includes(role.code) && !role.permissions.includes(permission as never)) {
                await roleService.update(ctx, {
                    id: role.id,
                    permissions: [...role.permissions, permission] as never,
                });
                notes.push(`${role.code}: ${permission}`);
            }
        }
        return notes;
    },
};

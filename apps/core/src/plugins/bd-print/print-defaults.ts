import { RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { printOrdersPermission } from './constants';

/** The default roles (phase 02) that print. Marketing doesn't. */
const PRINTING_ROLES = ['owner', 'manager', 'order-staff', 'packer'];

/** Store defaults (phase 06): PrintOrders on the default roles; roles the merchant deleted are left alone. */
export const printPermissionsStep: StoreDefaultsStep = {
    id: 'print-permissions',
    description: 'The PrintOrders permission on the default staff roles that print',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const permission = printOrdersPermission.Permission;
        const notes: string[] = [];
        for (const role of roles.items) {
            if (PRINTING_ROLES.includes(role.code) && !role.permissions.includes(permission as never)) {
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

import { RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { editStorefrontPermission } from './constants';

/** The default roles (phase 02) that design the storefront. */
const STOREFRONT_ROLES = ['owner', 'manager', 'marketing'];

/** Store defaults (phase 15): EditStorefront on the default roles; roles the merchant deleted are left alone. */
export const storefrontPermissionsStep: StoreDefaultsStep = {
    id: 'storefront-permissions',
    description: 'The EditStorefront permission (theme and page editor) on the default staff roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const permission = editStorefrontPermission.Permission;
        const notes: string[] = [];
        for (const role of roles.items) {
            if (STOREFRONT_ROLES.includes(role.code) && !role.permissions.includes(permission as never)) {
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

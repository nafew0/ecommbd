import { RoleService, ScheduledTask } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import {
    cancelOrderPermission,
    confirmOrderPermission,
    packOrderPermission,
    readSalesFiguresPermission,
} from './constants';
import { OrderActionsService } from './order-actions.service';

const ALL = [
    confirmOrderPermission,
    cancelOrderPermission,
    packOrderPermission,
    readSalesFiguresPermission,
].map(permission => permission.Permission);

/** Which default role gets which order permission (roles from phase 02, bd-core/store-defaults/roles.ts). */
const GRANTS: Record<string, string[]> = {
    owner: ALL,
    manager: ALL,
    'order-staff': [confirmOrderPermission.Permission, cancelOrderPermission.Permission],
    packer: [packOrderPermission.Permission],
    marketing: [readSalesFiguresPermission.Permission],
};

/**
 * Store defaults (phase 04): the new order permissions on the default roles. A new step instead of
 * editing phase 02's roles step, so stores that already ran it get them too. Roles the merchant
 * deleted are left alone.
 */
export const orderPermissionsStep: StoreDefaultsStep = {
    id: 'order-permissions',
    description: 'Order permissions (confirm, cancel, pack, sales figures) on the default staff roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            const missing = (GRANTS[role.code] ?? []).filter(
                permission => !role.permissions.includes(permission as never),
            );
            if (missing.length) {
                await roleService.update(ctx, {
                    id: role.id,
                    permissions: [...role.permissions, ...missing] as never,
                });
                notes.push(`${role.code}: ${missing.join(', ')}`);
            }
        }
        return notes;
    },
};

/** Hourly: cancels unreachable New orders, only when the merchant turned on "cancel automatically". */
export const autoCancelTask = new ScheduledTask({
    id: 'bd-auto-cancel-unreachable',
    description: 'Cancel New orders nobody could reach (only when the store setting is on)',
    schedule: '17 * * * *',
    async execute({ injector, scheduledContext }) {
        const cancelled = await injector.get(OrderActionsService).autoCancelUnreachable(scheduledContext);
        return { cancelled };
    },
});

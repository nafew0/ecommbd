import { RoleService, ScheduledTask } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { readRiskPermission } from './constants';
import { IncompleteCheckoutService } from './incomplete-checkout.service';

const ROLES = ['owner', 'manager', 'order-staff'];

/** Store defaults (phase 11): owners, managers and order staff see the risk badge. */
export const fraudPermissionsStep: StoreDefaultsStep = {
    id: 'fraud-permissions',
    description: 'ReadRisk (the risk badge and its reasons) on the default staff roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            const permission = readRiskPermission.Permission;
            if (ROLES.includes(role.code) && !role.permissions.includes(permission as never)) {
                await roleService.update(ctx, { id: role.id, permissions: [...role.permissions, permission] as never });
                notes.push(`${role.code}: ${permission}`);
            }
        }
        return notes;
    },
};

/** Daily: incomplete checkouts older than 30 days lose their personal data. */
export const incompleteExpiryTask = new ScheduledTask({
    id: 'bd-expire-incomplete-checkouts',
    description: 'Delete personal data of incomplete checkouts older than 30 days',
    schedule: '37 3 * * *',
    async execute({ injector, scheduledContext }) {
        return { expired: await injector.get(IncompleteCheckoutService).expire(scheduledContext) };
    },
});

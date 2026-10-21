import { Order, OrderService, RoleService, ScheduledTask, TransactionalConnection } from '@vendure/core';
import { LessThan } from 'typeorm';
import type { StoreDefaultsStep } from '../bd-core';
import {
    applyManualDiscountPermission,
    createManualOrderPermission,
    DRAFT_EXPIRY_DAYS,
    editOrderPermission,
    overridePricePermission,
    unlimitedDiscountPermission,
} from './constants';

const ALL = [
    createManualOrderPermission,
    editOrderPermission,
    overridePricePermission,
    applyManualDiscountPermission,
    unlimitedDiscountPermission,
].map(permission => permission.Permission);

/** Which default role (phase 02) gets which permission. Order staff discount up to 10%. */
const GRANTS: Record<string, string[]> = {
    owner: ALL,
    manager: ALL.filter(permission => permission !== unlimitedDiscountPermission.Permission),
    'order-staff': [
        createManualOrderPermission.Permission,
        editOrderPermission.Permission,
        applyManualDiscountPermission.Permission,
    ],
};

/** Store defaults (phase 05): the manual order permissions on the default roles. */
export const manualOrderPermissionsStep: StoreDefaultsStep = {
    id: 'manual-order-permissions',
    description: 'Manual order, edit, price and discount permissions on the default staff roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            const missing = (GRANTS[role.code] ?? []).filter(p => !role.permissions.includes(p as never));
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

/** Daily: draft orders nobody finished (e.g. started in the Dashboard) are deleted after 7 days. */
export const draftCleanupTask = new ScheduledTask({
    id: 'bd-delete-old-drafts',
    description: 'Delete draft orders older than 7 days',
    schedule: '21 4 * * *',
    async execute({ injector, scheduledContext }) {
        const before = new Date(Date.now() - DRAFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const drafts = await injector
            .get(TransactionalConnection)
            .getRepository(scheduledContext, Order)
            .find({
                where: { state: 'Draft', updatedAt: LessThan(before) },
                select: { id: true },
                take: 500,
            });
        for (const draft of drafts) {
            await injector.get(OrderService).deleteOrder(scheduledContext, draft.id);
        }
        return { deleted: drafts.length };
    },
});

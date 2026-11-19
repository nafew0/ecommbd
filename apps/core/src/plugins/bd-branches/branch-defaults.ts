import { RoleService, StockLocation, TransactionalConnection } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { manageBranchPermission, readBranchPermission } from './constants';

/** Who may change branches. Order staff and packers can see which branch ships an order. */
const MANAGE = ['owner', 'manager'];
const READ = ['owner', 'manager', 'order-staff', 'packer'];

/**
 * Store defaults (phase 54): branch permissions, and the original location sells online.
 * A new step, so stores that already ran the roles step get it too. It does not touch stock.
 */
export const branchSetupStep: StoreDefaultsStep = {
    id: 'branch-setup',
    description: 'ReadBranch and ManageBranch, and the original location sells online',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            if (!READ.includes(role.code)) continue;
            const grant = MANAGE.includes(role.code)
                ? [readBranchPermission.Permission, manageBranchPermission.Permission]
                : [readBranchPermission.Permission];
            const missing = grant.filter(permission => !role.permissions.includes(permission as never));
            if (missing.length === 0) continue;
            await roleService.update(ctx, {
                id: role.id,
                permissions: [...role.permissions, ...missing] as never,
            });
            notes.push(`${role.code}: ${missing.join(', ')}`);
        }

        const locations = await injector
            .get(TransactionalConnection)
            .getRepository(ctx, StockLocation)
            .find({ order: { createdAt: 'ASC', id: 'ASC' } });
        const oldest = locations[0];
        if (oldest && !locations.some(location => location.customFields.sellsOnline)) {
            oldest.customFields.sellsOnline = true;
            await injector.get(TransactionalConnection).getRepository(ctx, StockLocation).save(oldest);
            notes.push(`sells online: ${oldest.id}`);
        }
        return notes;
    },
};

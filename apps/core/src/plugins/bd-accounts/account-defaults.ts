import { DEFAULT_EXPENSE_HEADS } from '@ecommbd/shared';
import { RoleService, TransactionalConnection } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { manageAccountsPermission } from './constants';
import { BdExpenseHead } from './entities';

/**
 * Store defaults (phase 53): ManageAccounts on the owner only, and the seven expense heads.
 * A new step, so stores that already ran the roles step get it too. Heads are seeded once.
 */
export const accountsPermissionsStep: StoreDefaultsStep = {
    id: 'accounts-permissions',
    description: 'ManageAccounts on the owner, and the default expense heads',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            if (role.code !== 'owner') continue;
            if (role.permissions.includes(manageAccountsPermission.Permission as never)) continue;
            await roleService.update(ctx, {
                id: role.id,
                permissions: [...role.permissions, manageAccountsPermission.Permission] as never,
            });
            notes.push(`owner: ${manageAccountsPermission.Permission}`);
        }
        const heads = injector.get(TransactionalConnection).getRepository(ctx, BdExpenseHead);
        const existing = await heads.find();
        if (existing.length === 0) {
            await heads.save(DEFAULT_EXPENSE_HEADS.map(head => new BdExpenseHead({ ...head })));
            notes.push('expense heads');
        }
        return notes;
    },
};

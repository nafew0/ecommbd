import { defaultMenus } from '@ecommbd/shared';
import {
    Collection,
    CollectionTranslation,
    Product,
    ProductTranslation,
    RoleService,
    SettingsStoreService,
    TransactionalConnection,
} from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { manageContentPermission, MENUS_KEY } from './constants';
import { SlugHistoryService } from './slug.service';

/** The default roles (phase 02) that edit storefront content. */
const CONTENT_ROLES = ['owner', 'manager', 'marketing'];

/** Store defaults (phase 12): ManageContent on the default roles; roles the merchant deleted are left alone. */
export const contentPermissionsStep: StoreDefaultsStep = {
    id: 'content-permissions',
    description: 'The ManageContent permission on the default staff roles that edit pages and menus',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const permission = manageContentPermission.Permission;
        const notes: string[] = [];
        for (const role of roles.items) {
            if (CONTENT_ROLES.includes(role.code) && !role.permissions.includes(permission as never)) {
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

/** Store defaults (phase 12): the footer menu links the four policy pages. */
export const contentMenusStep: StoreDefaultsStep = {
    id: 'content-menus',
    description: 'Footer menu with the return, refund, privacy and terms pages',
    async run({ ctx, injector }) {
        const settingsStore = injector.get(SettingsStoreService);
        if (await settingsStore.get(ctx, MENUS_KEY)) return [];
        await settingsStore.set(ctx, MENUS_KEY, defaultMenus());
        return ['footer menu with the policy pages'];
    },
};

/** Store defaults (phase 12): records the slugs of products and categories made before slug history. */
export const slugBackfillStep: StoreDefaultsStep = {
    id: 'slug-history-backfill',
    description: 'Slug history for existing products and categories',
    async run({ ctx, injector }) {
        const connection = injector.get(TransactionalConnection);
        const slugs = injector.get(SlugHistoryService);
        let count = 0;
        const products = await connection
            .getRepository(ctx, Product)
            .find({ withDeleted: true, select: ['id', 'deletedAt'] });
        for (const product of products) {
            const translations = await connection
                .getRepository(ctx, ProductTranslation)
                .find({ where: { base: { id: product.id } } });
            await slugs.record('product', product.id, translations);
            if (product.deletedAt) await slugs.markDeleted('product', product.id);
            count++;
        }
        const collections = await connection.getRepository(ctx, Collection).find({ select: ['id'] });
        for (const collection of collections) {
            const translations = await connection
                .getRepository(ctx, CollectionTranslation)
                .find({ where: { base: { id: collection.id } } });
            await slugs.record('collection', collection.id, translations);
            count++;
        }
        return count ? [`${count} products and categories`] : [];
    },
};

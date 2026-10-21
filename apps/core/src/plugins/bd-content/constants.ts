import { PermissionDefinition } from '@vendure/core';

/** Keys in Vendure's settings store. */
export const MENUS_KEY = 'bdContent.menus';

export const manageContentPermission = new PermissionDefinition({
    name: 'ManageContent',
    description: 'Edit storefront pages and menus',
});

export const CONTENT_LANGUAGES = ['bn', 'en'] as const;

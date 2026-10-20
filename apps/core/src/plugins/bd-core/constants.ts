import { PermissionDefinition } from '@vendure/core';

export const BD_CORE_PLUGIN_OPTIONS = Symbol('BD_CORE_PLUGIN_OPTIONS');
export const loggerCtx = 'BdCorePlugin';

/** Changing store settings (profile, policies, language) needs this, on top of being signed in. */
export const updateStoreSettingsPermission = new PermissionDefinition({
    name: 'UpdateStoreSettings',
    description: 'Change the store settings: profile, policies and language',
});

/** Keys in Vendure's settings store (`namespace.field`). */
export const SETTINGS_KEYS = {
    /** The store settings (StoreSettings from @ecommbd/shared). Written only by StoreSettingsService. */
    storeSettings: 'bdStore.settings',
    /** The last changes to the store settings: who, when, which fields (no values). */
    storeSettingsHistory: 'bdStore.history',
    /** Which store-defaults steps have run, so a re-run skips them. */
    storeDefaults: 'bdStore.defaults',
    /** The admin language each staff user picked (per user). */
    adminLanguage: 'bdAdmin.language',
} as const;

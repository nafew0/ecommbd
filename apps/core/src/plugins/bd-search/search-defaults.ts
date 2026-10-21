import { defaultSearchSettings } from '@ecommbd/shared';
import { ScheduledTask, SettingsStoreService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { SEARCH_SETTINGS_KEY } from './constants';
import { BdSearchService } from './search.service';

/** Store defaults (phase 13): starter synonyms for common Bangladeshi spellings, if none are set. */
export const searchSynonymsStep: StoreDefaultsStep = {
    id: 'search-synonyms',
    description: 'Starter search synonyms (panjabi ⇄ পাঞ্জাবি, t-shirt ⇄ টি-শার্ট…)',
    async run({ ctx, injector }) {
        const settingsStore = injector.get(SettingsStoreService);
        if (await settingsStore.get(ctx, SEARCH_SETTINGS_KEY)) return [];
        await settingsStore.set(ctx, SEARCH_SETTINGS_KEY, defaultSearchSettings());
        return [`${defaultSearchSettings().synonyms.length} synonym groups`];
    },
};

/** Daily: searches with no results are kept for 30 days. */
export const searchMissCleanupTask = new ScheduledTask({
    id: 'bd-delete-old-search-misses',
    description: 'Delete searches with no results older than 30 days',
    schedule: '37 3 * * *',
    async execute({ injector }) {
        return { deleted: await injector.get(BdSearchService).deleteOldMisses() };
    },
});

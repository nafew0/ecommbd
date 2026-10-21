import { env } from '../env';
import { DataCache } from './cache';
import { type ResultOf, shopQuery } from './core';
import type { Lang } from './i18n';
import { MENUS, SETTINGS, TOP_COLLECTIONS } from './queries';

/** Store-wide data every page needs, through the data cache (see cache.ts). */

export type StoreSettings = ResultOf<typeof SETTINGS>['bdStoreSettings'];
export type Menus = ResultOf<typeof MENUS>['bdMenus'];
export type TopCollections = ResultOf<typeof TOP_COLLECTIONS>['collections']['items'];

let instance: DataCache | undefined;

export function dataCache(): DataCache {
    if (!instance) {
        const config = env();
        instance = new DataCache({
            ttlSeconds: config.CACHE_TTL_SECONDS,
            prefix: config.REDIS_KEY_PREFIX,
            redis:
                config.REDIS_CACHE_HOST && config.REDIS_CACHE_PORT
                    ? {
                          host: config.REDIS_CACHE_HOST,
                          port: config.REDIS_CACHE_PORT,
                          username: config.REDIS_CACHE_USERNAME,
                          password: config.REDIS_CACHE_PASSWORD,
                      }
                    : undefined,
        });
    }
    return instance;
}

export function getSettings(): Promise<StoreSettings> {
    return dataCache().get(
        'settings',
        ['settings'],
        async () => (await shopQuery(SETTINGS, {}, 'bn')).bdStoreSettings,
    );
}

export function getMenus(lang: Lang): Promise<Menus> {
    return dataCache().get(
        `menus:${lang}`,
        ['menus'],
        async () => (await shopQuery(MENUS, {}, lang)).bdMenus,
    );
}

export function getTopCollections(lang: Lang): Promise<TopCollections> {
    return dataCache().get(
        `collections:top:${lang}`,
        ['collections'],
        async () => (await shopQuery(TOP_COLLECTIONS, {}, lang)).collections.items,
    );
}

/** The store's name in a language, falling back to the other. */
export function storeName(settings: StoreSettings, lang: Lang): string {
    const name = settings.profile.storeName;
    return (lang === 'bn' ? name.bn || name.en : name.en || name.bn) || 'Shop';
}

export function bilingual(text: { bn: string; en: string }, lang: Lang): string {
    return lang === 'bn' ? text.bn || text.en : text.en || text.bn;
}

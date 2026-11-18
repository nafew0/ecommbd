import {
    defaultPurchaseSettings,
    type ParsePurchaseSettingsResult,
    parsePurchaseSettings,
    type PurchaseSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { PURCHASE_SETTINGS_KEY } from './constants';

/** Purchase settings in Vendure's settings store. Read once per request. */
@Injectable()
export class PurchaseSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<PurchaseSettings> {
        return this.requestCache.get(ctx, PURCHASE_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<PurchaseSettings>(ctx, PURCHASE_SETTINGS_KEY);
            return mergeDefaults(defaultPurchaseSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<ParsePurchaseSettingsResult> {
        const parsed = parsePurchaseSettings(input);
        if (!parsed.ok) return parsed;
        const saved = await this.settingsStore.set(ctx, PURCHASE_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save purchase settings: ${saved.error}`);
        this.requestCache.set(ctx, PURCHASE_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return parsed;
    }
}

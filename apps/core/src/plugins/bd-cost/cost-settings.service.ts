import {
    type CostSettings,
    defaultCostSettings,
    parseCostSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { COST_SETTINGS_KEY } from './constants';

export type UpdateCostSettingsResult =
    { settings: CostSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** Cost settings in Vendure's settings store. Read once per request. */
@Injectable()
export class CostSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<CostSettings> {
        return this.requestCache.get(ctx, COST_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<CostSettings>(ctx, COST_SETTINGS_KEY);
            return mergeDefaults(defaultCostSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateCostSettingsResult> {
        const parsed = parseCostSettings(input);
        if (!parsed.ok) return { settings: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, COST_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save cost settings: ${saved.error}`);
        this.requestCache.set(ctx, COST_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

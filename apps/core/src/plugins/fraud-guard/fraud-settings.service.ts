import {
    defaultFraudSettings,
    type FraudSettings,
    parseFraudSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { FRAUD_SETTINGS_KEY } from './constants';

export type UpdateFraudSettingsResult =
    | { settings: FraudSettings; errors: [] }
    | { settings: null; errors: SettingsFieldError[] };

/** Fake-order protection settings in Vendure's settings store, read once per request. */
@Injectable()
export class FraudSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<FraudSettings> {
        return this.requestCache.get(ctx, FRAUD_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<FraudSettings>(ctx, FRAUD_SETTINGS_KEY);
            return mergeDefaults(defaultFraudSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateFraudSettingsResult> {
        const parsed = parseFraudSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, FRAUD_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save fake-order protection settings: ${saved.error}`);
        }
        this.requestCache.set(ctx, FRAUD_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

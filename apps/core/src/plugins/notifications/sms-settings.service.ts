import { defaultSmsSettings, parseSmsSettings, type SettingsFieldError, type SmsSettings } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { SMS_SETTINGS_KEY } from './constants';

export type UpdateSmsSettingsResult =
    { settings: SmsSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** SMS settings in Vendure's settings store, read once per request. */
@Injectable()
export class SmsSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<SmsSettings> {
        return this.requestCache.get(ctx, SMS_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<SmsSettings>(ctx, SMS_SETTINGS_KEY);
            return mergeDefaults(defaultSmsSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateSmsSettingsResult> {
        const parsed = parseSmsSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, SMS_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save SMS settings: ${saved.error}`);
        }
        this.requestCache.set(ctx, SMS_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

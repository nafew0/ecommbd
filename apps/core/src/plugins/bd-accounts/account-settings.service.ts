import {
    defaultAccountSettings,
    type ParseAccountSettingsResult,
    parseAccountSettings,
    type AccountSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { ACCOUNT_SETTINGS_KEY } from './constants';

/** Which account receives COD, the gateway and each mobile wallet. */
@Injectable()
export class AccountSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<AccountSettings> {
        return this.requestCache.get(ctx, ACCOUNT_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<AccountSettings>(ctx, ACCOUNT_SETTINGS_KEY);
            return mergeDefaults(defaultAccountSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<ParseAccountSettingsResult> {
        const parsed = parseAccountSettings(input);
        if (!parsed.ok) return parsed;
        const saved = await this.settingsStore.set(ctx, ACCOUNT_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save account settings: ${saved.error}`);
        this.requestCache.set(ctx, ACCOUNT_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return parsed;
    }
}

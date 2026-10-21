import {
    defaultPaymentSettings,
    parsePaymentSettings,
    type PaymentSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { PAYMENT_SETTINGS_KEY } from './constants';

export type UpdatePaymentSettingsResult =
    { settings: PaymentSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** Payment settings in Vendure's settings store, read once per request. */
@Injectable()
export class PaymentSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<PaymentSettings> {
        return this.requestCache.get(ctx, PAYMENT_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<PaymentSettings>(ctx, PAYMENT_SETTINGS_KEY);
            return mergeDefaults(defaultPaymentSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdatePaymentSettingsResult> {
        const parsed = parsePaymentSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, PAYMENT_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save payment settings: ${saved.error}`);
        }
        this.requestCache.set(ctx, PAYMENT_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

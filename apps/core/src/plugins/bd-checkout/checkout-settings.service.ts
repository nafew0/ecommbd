import {
    type CheckoutSettings,
    defaultCheckoutSettings,
    parseCheckoutSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { CHECKOUT_SETTINGS_KEY } from './constants';

export type UpdateCheckoutSettingsResult =
    { settings: CheckoutSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** The merchant's checkout choices, in Vendure's settings store. Only this service writes them. */
@Injectable()
export class CheckoutSettingsService {
    constructor(private settingsStore: SettingsStoreService) {}

    /** The stored settings, with fields added since they were saved filled from the defaults. */
    async get(ctx: RequestContext): Promise<CheckoutSettings> {
        const stored = await this.settingsStore.get<CheckoutSettings>(ctx, CHECKOUT_SETTINGS_KEY);
        return mergeDefaults(defaultCheckoutSettings(), stored ?? undefined);
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateCheckoutSettingsResult> {
        const parsed = parseCheckoutSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, CHECKOUT_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save checkout settings: ${saved.error}`);
        }
        return { settings: parsed.settings, errors: [] };
    }
}

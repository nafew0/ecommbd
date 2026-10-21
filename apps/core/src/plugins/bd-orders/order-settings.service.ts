import {
    defaultOrderSettings,
    type OrderSettings,
    parseOrderSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { ORDER_SETTINGS_KEY } from './constants';

export type UpdateOrderSettingsResult =
    { settings: OrderSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** Order settings in Vendure's settings store. Read once per request (lists read them per row). */
@Injectable()
export class OrderSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<OrderSettings> {
        return this.requestCache.get(ctx, ORDER_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<OrderSettings>(ctx, ORDER_SETTINGS_KEY);
            return mergeDefaults(defaultOrderSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateOrderSettingsResult> {
        const parsed = parseOrderSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, ORDER_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save order settings: ${saved.error}`);
        }
        this.requestCache.set(ctx, ORDER_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

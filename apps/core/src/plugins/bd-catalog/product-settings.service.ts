import {
    defaultProductSettings,
    parseProductSettings,
    PRODUCT_SETTINGS_KEY,
    type ProductSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';

export type UpdateProductSettingsResult =
    { settings: ProductSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/**
 * Units, shipping classes and the SKU prefix (phase 55), in Vendure's settings store. Read once
 * per request. Delivery reads the same key itself (shipping-bd), so it doesn't depend on this plugin.
 */
@Injectable()
export class ProductSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {}

    get(ctx: RequestContext): Promise<ProductSettings> {
        return this.requestCache.get(ctx, PRODUCT_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<ProductSettings>(ctx, PRODUCT_SETTINGS_KEY);
            return mergeDefaults(defaultProductSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateProductSettingsResult> {
        const parsed = parseProductSettings(input);
        if (!parsed.ok) return { settings: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, PRODUCT_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save product settings: ${saved.error}`);
        this.requestCache.set(ctx, PRODUCT_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { settings: parsed.settings, errors: [] };
    }
}

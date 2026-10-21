import { findDistrict, findThana } from '@ecommbd/bd-geo';
import {
    defaultShippingSettings,
    parseShippingSettings,
    type SettingsFieldError,
    type ShippingSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Collection,
    RequestContext,
    RequestContextCacheService,
    SettingsStoreService,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';
import { mergeDefaults } from '../bd-core';
import { SHIPPING_SETTINGS_KEY } from './constants';

export type UpdateShippingSettingsResult =
    { settings: ShippingSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/**
 * Delivery settings in Vendure's settings store. Read once per request: the checker and calculator
 * run for every method on every cart change.
 */
@Injectable()
export class ShippingSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
        private connection: TransactionalConnection,
    ) {}

    get(ctx: RequestContext): Promise<ShippingSettings> {
        return this.requestCache.get(ctx, SHIPPING_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<ShippingSettings>(ctx, SHIPPING_SETTINGS_KEY);
            return mergeDefaults(defaultShippingSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateShippingSettingsResult> {
        const parsed = parseShippingSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const settings = { ...parsed.settings, confirmed: true };
        const errors = await this.findUnknownIds(ctx, settings);
        if (errors.length) {
            return { settings: null, errors };
        }
        const saved = await this.settingsStore.set(ctx, SHIPPING_SETTINGS_KEY, settings);
        if (!saved.result) {
            throw new Error(`Could not save delivery settings: ${saved.error}`);
        }
        this.requestCache.set(ctx, SHIPPING_SETTINGS_KEY, Promise.resolve(settings));
        return { settings, errors: [] };
    }

    /** Districts, thanas and collections must exist (only their IDs ever reach the calculator). */
    private async findUnknownIds(ctx: RequestContext, settings: ShippingSettings): Promise<SettingsFieldError[]> {
        const errors: SettingsFieldError[] = [];
        settings.overrides.forEach((override, index) => {
            const known = override.kind === 'district' ? findDistrict(override.id) : findThana(override.id);
            if (!known) {
                errors.push({ path: `overrides.${index}.id`, code: 'notFound' });
            }
        });
        settings.coverage.districtIds.forEach((id, index) => {
            if (!findDistrict(id)) {
                errors.push({ path: `coverage.districtIds.${index}`, code: 'notFound' });
            }
        });
        if (settings.freeCollectionIds.length) {
            const found = await this.connection
                .getRepository(ctx, Collection)
                .find({ where: { id: In(settings.freeCollectionIds) }, select: { id: true } });
            const ids = new Set(found.map(collection => String(collection.id)));
            settings.freeCollectionIds.forEach((id, index) => {
                if (!ids.has(id)) {
                    errors.push({ path: `freeCollectionIds.${index}`, code: 'notFound' });
                }
            });
        }
        return errors;
    }
}

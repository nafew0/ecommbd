import {
    defaultBranchSettings,
    type ParseBranchSettingsResult,
    parseBranchSettings,
    type BranchSettings,
    type ShippingZone,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService, RequestContext, RequestContextCacheService, SettingsStoreService, type ID } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { BRANCH_SETTINGS_KEY } from './constants';
import { publicId, rawId } from './ids';

/** Branch settings in Vendure's settings store. Ids are stored as database ids. */
@Injectable()
export class BranchSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
        private config: ConfigService,
    ) {}

    async get(ctx: RequestContext): Promise<BranchSettings> {
        const stored = await this.requestCache.get(ctx, BRANCH_SETTINGS_KEY, async () => {
            const value = await this.settingsStore.get<BranchSettings>(ctx, BRANCH_SETTINGS_KEY);
            return mergeDefaults(defaultBranchSettings(), value ?? undefined);
        });
        return this.decoded(stored);
    }

    /** The same settings with ids encoded the way the admin's selects send them. */
    async getPublic(ctx: RequestContext): Promise<BranchSettings> {
        const settings = await this.get(ctx);
        const id = (value: string) => publicId(this.config, value);
        return {
            transferPrefix: settings.transferPrefix,
            zoneBranch: {
                dhaka_city: id(settings.zoneBranch.dhaka_city),
                dhaka_suburb: id(settings.zoneBranch.dhaka_suburb),
                chattogram_city: id(settings.zoneBranch.chattogram_city),
                outside_dhaka: id(settings.zoneBranch.outside_dhaka),
            },
            pickupBranch: {
                steadfast: id(settings.pickupBranch.steadfast),
                pathao: id(settings.pickupBranch.pathao),
            },
        };
    }

    async update(ctx: RequestContext, input: unknown): Promise<ParseBranchSettingsResult> {
        const parsed = parseBranchSettings(input);
        if (!parsed.ok) return parsed;
        const settings = this.decoded(parsed.settings);
        const saved = await this.settingsStore.set(ctx, BRANCH_SETTINGS_KEY, settings);
        if (!saved.result) throw new Error(`Could not save branch settings: ${saved.error}`);
        this.requestCache.set(ctx, BRANCH_SETTINGS_KEY, Promise.resolve(settings));
        return { ok: true, settings: await this.getPublic(ctx) };
    }

    /** Drops a deleted branch from the zone and courier defaults. */
    async clearLocation(ctx: RequestContext, locationId: ID): Promise<void> {
        const settings = await this.get(ctx);
        const id = String(locationId);
        const zone = (value: string) => (value === id ? '' : value);
        const next: BranchSettings = {
            transferPrefix: settings.transferPrefix,
            zoneBranch: {
                dhaka_city: zone(settings.zoneBranch.dhaka_city),
                dhaka_suburb: zone(settings.zoneBranch.dhaka_suburb),
                chattogram_city: zone(settings.zoneBranch.chattogram_city),
                outside_dhaka: zone(settings.zoneBranch.outside_dhaka),
            },
            pickupBranch: {
                steadfast: zone(settings.pickupBranch.steadfast),
                pathao: zone(settings.pickupBranch.pathao),
            },
        };
        if (JSON.stringify(next) === JSON.stringify(settings)) return;
        const saved = await this.settingsStore.set(ctx, BRANCH_SETTINGS_KEY, next);
        if (!saved.result) throw new Error(`Could not save branch settings: ${saved.error}`);
        this.requestCache.set(ctx, BRANCH_SETTINGS_KEY, Promise.resolve(next));
    }

    zoneDefault(settings: BranchSettings, zone: ShippingZone): string {
        return settings.zoneBranch[zone] ?? '';
    }

    private decoded(settings: BranchSettings): BranchSettings {
        const id = (value: string) => {
            const raw = rawId(this.config, value);
            return raw == null ? '' : String(raw);
        };
        return {
            transferPrefix: settings.transferPrefix,
            zoneBranch: {
                dhaka_city: id(settings.zoneBranch.dhaka_city),
                dhaka_suburb: id(settings.zoneBranch.dhaka_suburb),
                chattogram_city: id(settings.zoneBranch.chattogram_city),
                outside_dhaka: id(settings.zoneBranch.outside_dhaka),
            },
            pickupBranch: {
                steadfast: id(settings.pickupBranch.steadfast),
                pathao: id(settings.pickupBranch.pathao),
            },
        };
    }
}

import { findDistrict, isThanaInDistrict, OTHER_THANA_ID } from '@ecommbd/bd-geo';
import {
    changedSettingsPaths,
    emptyStoreSettings,
    parseStoreSettings,
    POLICY_KEYS,
    type SettingsFieldError,
    type StoreLanguage,
    type StoreSettings,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    AdministratorService,
    AssetService,
    ChannelService,
    CurrencyCode,
    ID,
    isGraphQlErrorResult,
    LanguageCode,
    RequestContext,
    RequestContextService,
    SettingsStoreService,
} from '@vendure/core';
import { SETTINGS_KEYS } from '../constants';
import { POLICY_TEMPLATES } from './policy-templates';

export interface StoreSettingsChange {
    at: string;
    administratorId: string | null;
    administratorName: string;
    /** Which fields changed (paths only: no values, so no personal data in the history). */
    fields: string[];
}

export type StoreSettingsWarning = 'currencyNotBdt' | 'pricesExcludeTax';

export type UpdateStoreSettingsResult =
    { settings: StoreSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** How many changes the history keeps. The full activity log arrives in phase 32. */
const HISTORY_LIMIT = 50;

/**
 * The store's settings (profile, policies, locale), kept in Vendure's settings store. Only this
 * service writes them: the generic settings-store API sees them as read-only.
 */
@Injectable()
export class StoreSettingsService {
    constructor(
        private settingsStore: SettingsStoreService,
        private channelService: ChannelService,
        private assetService: AssetService,
        private administratorService: AdministratorService,
        private requestContextService: RequestContextService,
    ) {}

    /** The stored settings, with any field added since they were saved filled from the defaults. */
    async get(ctx: RequestContext): Promise<StoreSettings> {
        const defaults = this.defaults(ctx.channel.defaultLanguageCode === LanguageCode.en ? 'en' : 'bn');
        const stored = await this.settingsStore.get<StoreSettings>(ctx, SETTINGS_KEYS.storeSettings);
        return stored ? mergeDefaults(defaults, stored) : defaults;
    }

    /** Saves the defaults (with the policy templates) if nothing is stored yet. */
    async initialize(ctx: RequestContext, language: StoreLanguage): Promise<boolean> {
        if (await this.settingsStore.get(ctx, SETTINGS_KEYS.storeSettings)) {
            return false;
        }
        await this.save(ctx, this.defaults(language));
        return true;
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateStoreSettingsResult> {
        const parsed = parseStoreSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const next = parsed.settings;
        const errors = await this.checkReferences(ctx, next);
        if (errors.length) {
            return { settings: null, errors };
        }
        const current = await this.get(ctx);
        for (const key of POLICY_KEYS) {
            const before = current.policies[key];
            const after = next.policies[key];
            if (after.bn !== before.bn || after.en !== before.en) {
                after.isTemplate = false;
            }
        }
        const changed = changedSettingsPaths(current, next);
        if (changed.length === 0) {
            return { settings: current, errors: [] };
        }
        if (next.locale.defaultLanguage !== current.locale.defaultLanguage) {
            await this.setChannelLanguage(ctx, next.locale.defaultLanguage);
        }
        await this.save(ctx, next);
        await this.recordChange(ctx, changed);
        return { settings: next, errors: [] };
    }

    async history(ctx: RequestContext): Promise<StoreSettingsChange[]> {
        return (
            (await this.settingsStore.get<StoreSettingsChange[]>(ctx, SETTINGS_KEYS.storeSettingsHistory)) ??
            []
        );
    }

    /** Settings that work against couriers and payments, shown as a warning on the settings page. */
    warnings(ctx: RequestContext): StoreSettingsWarning[] {
        const warnings: StoreSettingsWarning[] = [];
        if (ctx.channel.defaultCurrencyCode !== CurrencyCode.BDT) {
            warnings.push('currencyNotBdt');
        }
        if (!ctx.channel.pricesIncludeTax) {
            warnings.push('pricesExcludeTax');
        }
        return warnings;
    }

    async findAsset(ctx: RequestContext, id: string | null) {
        return id ? ((await this.assetService.findOne(ctx, id as ID)) ?? null) : null;
    }

    private defaults(language: StoreLanguage): StoreSettings {
        const settings = emptyStoreSettings(language);
        for (const key of POLICY_KEYS) {
            settings.policies[key] = { ...POLICY_TEMPLATES[key], isTemplate: true };
        }
        return settings;
    }

    private async checkReferences(
        ctx: RequestContext,
        settings: StoreSettings,
    ): Promise<SettingsFieldError[]> {
        const errors: SettingsFieldError[] = [];
        for (const field of ['logoAssetId', 'faviconAssetId'] as const) {
            const id = settings.profile[field];
            if (id && !(await this.findAsset(ctx, id))) {
                errors.push({ path: `profile.${field}`, code: 'notFound' });
            }
        }
        const { districtId, thanaId } = settings.profile.address;
        if (districtId && !findDistrict(districtId)) {
            errors.push({ path: 'profile.address.districtId', code: 'notFound' });
        } else if (districtId && thanaId !== OTHER_THANA_ID && !isThanaInDistrict(districtId, thanaId)) {
            errors.push({ path: 'profile.address.thanaId', code: 'notFound' });
        }
        return errors;
    }

    private async save(ctx: RequestContext, settings: StoreSettings) {
        const result = await this.settingsStore.set(ctx, SETTINGS_KEYS.storeSettings, settings);
        if (!result.result) {
            throw new Error(`Could not save store settings: ${result.error}`);
        }
    }

    private async recordChange(ctx: RequestContext, fields: string[]) {
        const administrator = ctx.activeUserId
            ? await this.administratorService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        const entry: StoreSettingsChange = {
            at: new Date().toISOString(),
            administratorId: administrator ? String(administrator.id) : null,
            administratorName: administrator
                ? `${administrator.firstName} ${administrator.lastName}`.trim()
                : 'System',
            fields,
        };
        const history = [entry, ...(await this.history(ctx))].slice(0, HISTORY_LIMIT);
        await this.settingsStore.set(ctx, SETTINGS_KEYS.storeSettingsHistory, history as never);
    }

    /**
     * The storefront's default language is the channel's. Changing it needs `UpdateStoreSettings`,
     * not `UpdateChannel`, so the channel is updated with a system context (no session).
     */
    private async setChannelLanguage(ctx: RequestContext, language: StoreLanguage) {
        const systemCtx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: ctx.channel,
        });
        const languageCode = language === 'bn' ? LanguageCode.bn : LanguageCode.en;
        const available = [...new Set([...ctx.channel.availableLanguageCodes, languageCode])];
        const result = await this.channelService.update(systemCtx, {
            id: ctx.channel.id,
            defaultLanguageCode: languageCode,
            availableLanguageCodes: available,
        });
        if (isGraphQlErrorResult(result)) {
            throw new Error(`Could not change the store language: ${result.message}`);
        }
    }
}

/** Fills keys missing from `value` (settings saved by an older release) from `defaults`. Arrays are values. */
export function mergeDefaults<T>(defaults: T, value: unknown): T {
    const isObject = (input: unknown): input is Record<string, unknown> =>
        typeof input === 'object' && input !== null && !Array.isArray(input);
    if (!isObject(defaults) || !isObject(value)) {
        return (value === undefined ? defaults : value) as T;
    }
    const result: Record<string, unknown> = { ...value };
    for (const [key, fallback] of Object.entries(defaults)) {
        result[key] = mergeDefaults(fallback, value[key]);
    }
    return result as T;
}

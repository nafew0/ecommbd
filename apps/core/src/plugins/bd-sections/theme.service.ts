import { checkThemeInput, readThemeSettings, type ThemeProblem, type ThemeSettings } from '@ecommbd/sections';
import { Injectable } from '@nestjs/common';
import { RequestContext, SettingsStoreService } from '@vendure/core';
import { THEME_KEY } from './constants';
import { StorefrontPurger } from './storefront-purger';

export interface ThemeResult {
    settings: ThemeSettings | null;
    errors: ThemeProblem[];
    warnings: ThemeProblem[];
}

/** The storefront's theme settings (roadmap phase 15), in Vendure's settings store. */
@Injectable()
export class ThemeService {
    constructor(
        private settingsStore: SettingsStoreService,
        private purger: StorefrontPurger,
    ) {}

    async get(ctx: RequestContext): Promise<ThemeSettings> {
        return readThemeSettings(await this.settingsStore.get(ctx, THEME_KEY));
    }

    /** Saves unless the colours are invalid or the text unreadable; warnings come back either way. */
    async update(ctx: RequestContext, input: unknown): Promise<ThemeResult> {
        const { settings, errors, warnings } = checkThemeInput(input);
        if (errors.length) return { settings: null, errors, warnings };
        const saved = await this.settingsStore.set(ctx, THEME_KEY, settings);
        if (!saved.result) throw new Error(`Could not save the theme: ${saved.error}`);
        await this.purger.purge(['theme']);
        return { settings, errors: [], warnings };
    }
}

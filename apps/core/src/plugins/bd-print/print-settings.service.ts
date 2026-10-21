import {
    defaultPrintSettings,
    parsePrintSettings,
    type PrintSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { RequestContext, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { PRINT_SETTINGS_KEY } from './constants';

export type UpdatePrintSettingsResult =
    { settings: PrintSettings; errors: [] } | { settings: null; errors: SettingsFieldError[] };

/** Print settings in Vendure's settings store. Only this service writes them. */
@Injectable()
export class PrintSettingsService {
    constructor(private settingsStore: SettingsStoreService) {}

    async get(ctx: RequestContext): Promise<PrintSettings> {
        const stored = await this.settingsStore.get<PrintSettings>(ctx, PRINT_SETTINGS_KEY);
        return mergeDefaults(defaultPrintSettings(), stored ?? undefined);
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdatePrintSettingsResult> {
        const parsed = parsePrintSettings(input);
        if (!parsed.ok) {
            return { settings: null, errors: parsed.errors };
        }
        const saved = await this.settingsStore.set(ctx, PRINT_SETTINGS_KEY, parsed.settings);
        if (!saved.result) {
            throw new Error(`Could not save print settings: ${saved.error}`);
        }
        return { settings: parsed.settings, errors: [] };
    }
}

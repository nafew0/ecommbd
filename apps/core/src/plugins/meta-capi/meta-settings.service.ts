import {
    decryptSecret,
    defaultMetaSettings,
    encryptSecret,
    type Keyring,
    type MetaSettings,
    parseKeyring,
    parseMetaSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Logger, RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { loggerCtx, META_OPTIONS, META_SECRETS_KEY, META_SETTINGS_KEY, META_STATUS_KEY } from './constants';
import type { MetaCapiPluginOptions } from './types';

/**
 * A Pixel whose events are held: Meta refused its token (`token`, code 190) or the Pixel itself
 * (`pixel`: a wrong Pixel ID or a token without permission for it). Nothing is sent for it until
 * a new token is saved or "Send test event" works again; its events wait (up to Meta's 7 days).
 */
export interface MetaPixelHold {
    pixelId: string;
    kind: 'token' | 'pixel';
    /** Meta's own message (English), shown inside our bilingual warning. */
    message: string;
    at: string;
}

export interface MetaStatus {
    holds: MetaPixelHold[];
}

/**
 * Meta settings (Pixel IDs, trigger, browser Pixel on/off…) and each Pixel's Conversions API token,
 * encrypted with SECRETS_KEYRING under a context naming the Pixel; tokens never leave the server.
 */
@Injectable()
export class MetaSettingsService {
    private readonly keyring: Keyring | null;

    constructor(
        @Inject(META_OPTIONS) options: MetaCapiPluginOptions,
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {
        this.keyring = options.keyring ? parseKeyring(options.keyring) : null;
    }

    get keyringConfigured(): boolean {
        return !!this.keyring;
    }

    get(ctx: RequestContext): Promise<MetaSettings> {
        return this.requestCache.get(ctx, META_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<MetaSettings>(ctx, META_SETTINGS_KEY);
            return mergeDefaults(defaultMetaSettings(), stored ?? undefined);
        });
    }

    async update(
        ctx: RequestContext,
        input: unknown,
    ): Promise<{ value: MetaSettings | null; errors: SettingsFieldError[] }> {
        const parsed = parseMetaSettings(input);
        if (!parsed.ok) return { value: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, META_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save Meta settings: ${saved.error}`);
        this.requestCache.set(ctx, META_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { value: parsed.settings, errors: [] };
    }

    private async tokens(ctx: RequestContext): Promise<Record<string, string>> {
        return (await this.settingsStore.get<Record<string, string>>(ctx, META_SECRETS_KEY)) ?? {};
    }

    async token(ctx: RequestContext, pixelId: string): Promise<string | null> {
        const stored = (await this.tokens(ctx))[pixelId];
        if (!stored || !this.keyring) return null;
        try {
            return decryptSecret(stored, this.keyring, `metaCapi:${pixelId}`);
        } catch (error) {
            Logger.error(`Could not decrypt the token of Pixel ${pixelId}: ${String(error)}`, loggerCtx);
            return null;
        }
    }

    async saveToken(ctx: RequestContext, pixelId: string, token: string): Promise<SettingsFieldError[]> {
        if (!this.keyring) return [{ path: 'keyring', code: 'required' }];
        if (!/^\d{5,20}$/.test(pixelId)) return [{ path: 'pixelId', code: 'invalid' }];
        const trimmed = token.trim();
        if (!trimmed || trimmed.length > 1000 || /\s/.test(trimmed))
            return [{ path: 'token', code: 'invalid' }];
        const tokens = {
            ...(await this.tokens(ctx)),
            [pixelId]: encryptSecret(trimmed, this.keyring, `metaCapi:${pixelId}`),
        };
        const saved = await this.settingsStore.set(ctx, META_SECRETS_KEY, tokens);
        if (!saved.result) throw new Error(`Could not save the Meta token: ${saved.error}`);
        // A new token releases this Pixel's held events (the next run sends them); other Pixels keep theirs.
        await this.release(ctx, pixelId);
        return [];
    }

    async status(ctx: RequestContext): Promise<MetaStatus> {
        const stored = await this.settingsStore.get<
            Partial<MetaStatus> & { tokenProblem?: Omit<MetaPixelHold, 'kind'> | null }
        >(ctx, META_STATUS_KEY);
        if (stored?.holds) return { holds: stored.holds };
        // Saved before holds (one `tokenProblem`): read as a token hold.
        return { holds: stored?.tokenProblem ? [{ ...stored.tokenProblem, kind: 'token' }] : [] };
    }

    /** Holds a Pixel's events (replacing an earlier hold of the same Pixel). */
    async hold(ctx: RequestContext, hold: MetaPixelHold): Promise<void> {
        const { holds } = await this.status(ctx);
        await this.setStatus(ctx, { holds: [...holds.filter(item => item.pixelId !== hold.pixelId), hold] });
    }

    /** Ends a Pixel's hold. Returns false when it wasn't held. */
    async release(ctx: RequestContext, pixelId: string): Promise<boolean> {
        const { holds } = await this.status(ctx);
        const rest = holds.filter(item => item.pixelId !== pixelId);
        if (rest.length === holds.length) return false;
        await this.setStatus(ctx, { holds: rest });
        return true;
    }

    private async setStatus(ctx: RequestContext, status: MetaStatus): Promise<void> {
        await this.settingsStore.set(ctx, META_STATUS_KEY, status);
    }
}

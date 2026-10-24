import {
    COURIER_CREDENTIAL_FIELDS,
    COURIER_MODES,
    COURIER_PUBLIC_FIELDS,
    COURIERS,
    type Courier,
    type CourierMode,
    type CourierSettings,
    decryptSecret,
    defaultCourierSettings,
    encryptSecret,
    type Keyring,
    parseCourierSettings,
    parseKeyring,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Logger, RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { mergeDefaults } from '../bd-core';
import { COURIER_SECRETS_KEY, COURIER_SETTINGS_KEY, COURIERS_OPTIONS, loggerCtx } from './constants';
import type { CouriersPluginOptions } from './types';

/** Encrypted: credentials by courier and mode, and each courier's webhook secret. */
interface StoredSecrets {
    credentials?: Partial<Record<Courier, Partial<Record<CourierMode, string>>>>;
    webhooks?: Partial<Record<Courier, string>>;
}

export interface CourierCredentialsView {
    courier: Courier;
    mode: CourierMode;
    complete: boolean;
    fields: Array<{ name: string; saved: boolean; value: string | null }>;
}

export type UpdateResult<T> = { value: T; errors: [] } | { value: null; errors: SettingsFieldError[] };

/**
 * Courier settings (on/off, Pathao's store and mode, the default courier per zone, the fallback
 * weight), the couriers' credentials (encrypted with SECRETS_KEYRING, never sent back), and each
 * courier's webhook secret (made once, shown to staff to paste into the courier's panel).
 */
@Injectable()
export class CourierSettingsService {
    private readonly keyring: Keyring | null;

    constructor(
        @Inject(COURIERS_OPTIONS) options: CouriersPluginOptions,
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {
        this.keyring = options.keyring ? parseKeyring(options.keyring) : null;
    }

    get keyringConfigured(): boolean {
        return !!this.keyring;
    }

    get(ctx: RequestContext): Promise<CourierSettings> {
        return this.requestCache.get(ctx, COURIER_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<CourierSettings>(ctx, COURIER_SETTINGS_KEY);
            return mergeDefaults(defaultCourierSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateResult<CourierSettings>> {
        const parsed = parseCourierSettings(input);
        if (!parsed.ok) return { value: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, COURIER_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save courier settings: ${saved.error}`);
        this.requestCache.set(ctx, COURIER_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { value: parsed.settings, errors: [] };
    }

    /** The mode a courier is used in: Pathao's setting; Steadfast is always live. */
    async mode(ctx: RequestContext, courier: Courier): Promise<CourierMode> {
        return courier === 'pathao' ? (await this.get(ctx)).pathao.mode : 'live';
    }

    private async stored(ctx: RequestContext): Promise<StoredSecrets> {
        return (await this.settingsStore.get<StoredSecrets>(ctx, COURIER_SECRETS_KEY)) ?? {};
    }

    private decrypt(token: string | undefined, context: string): string | null {
        if (!token || !this.keyring) return null;
        try {
            return decryptSecret(token, this.keyring, context);
        } catch (error) {
            Logger.error(`Could not decrypt ${context}: ${String(error)}`, loggerCtx);
            return null;
        }
    }

    async credentials(
        ctx: RequestContext,
        courier: Courier,
        mode: CourierMode,
    ): Promise<Record<string, string> | null> {
        const text = this.decrypt(
            (await this.stored(ctx)).credentials?.[courier]?.[mode],
            context(courier, mode),
        );
        return text ? (JSON.parse(text) as Record<string, string>) : null;
    }

    complete(courier: Courier, credentials: Record<string, string> | null): boolean {
        return !!credentials && COURIER_CREDENTIAL_FIELDS[courier].every(field => !!credentials[field]);
    }

    async saveCredentials(
        ctx: RequestContext,
        courier: Courier,
        mode: CourierMode,
        input: unknown,
    ): Promise<UpdateResult<CourierCredentialsView>> {
        if (!this.keyring) return { value: null, errors: [{ path: 'keyring', code: 'required' }] };
        const saved = await this.credentials(ctx, courier, mode);
        const given = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
        const next: Record<string, string> = {};
        const errors: SettingsFieldError[] = [];
        for (const field of COURIER_CREDENTIAL_FIELDS[courier]) {
            const value = given[field];
            if (value !== undefined && value !== null && typeof value !== 'string') {
                errors.push({ path: field, code: 'invalid' });
                continue;
            }
            const typed = (value ?? '').trim();
            if (typed.length > 200) errors.push({ path: field, code: 'tooLong' });
            next[field] = typed || saved?.[field] || '';
        }
        if (errors.length) return { value: null, errors };
        const stored = await this.stored(ctx);
        stored.credentials = {
            ...stored.credentials,
            [courier]: {
                ...stored.credentials?.[courier],
                [mode]: encryptSecret(JSON.stringify(next), this.keyring, context(courier, mode)),
            },
        };
        await this.write(ctx, stored);
        return { value: view(courier, mode, next, this), errors: [] };
    }

    /** The courier's webhook secret, made (and stored encrypted) on first use. Null without a keyring. */
    async webhookSecret(ctx: RequestContext, courier: Courier): Promise<string | null> {
        if (!this.keyring) return null;
        const stored = await this.stored(ctx);
        const existing = this.decrypt(stored.webhooks?.[courier], `couriers:webhook:${courier}`);
        if (existing) return existing;
        const secret = randomBytes(24).toString('hex');
        stored.webhooks = {
            ...stored.webhooks,
            [courier]: encryptSecret(secret, this.keyring, `couriers:webhook:${courier}`),
        };
        await this.write(ctx, stored);
        return secret;
    }

    async credentialViews(ctx: RequestContext): Promise<CourierCredentialsView[]> {
        const views: CourierCredentialsView[] = [];
        for (const courier of COURIERS) {
            // Steadfast has one API for testing and live use.
            for (const mode of courier === 'steadfast' ? (['live'] as const) : COURIER_MODES) {
                views.push(view(courier, mode, await this.credentials(ctx, courier, mode), this));
            }
        }
        return views;
    }

    private async write(ctx: RequestContext, stored: StoredSecrets) {
        const saved = await this.settingsStore.set(ctx, COURIER_SECRETS_KEY, stored);
        if (!saved.result) throw new Error(`Could not save courier secrets: ${saved.error}`);
    }
}

const context = (courier: Courier, mode: CourierMode) => `couriers:${courier}:${mode}`;

function view(
    courier: Courier,
    mode: CourierMode,
    credentials: Record<string, string> | null,
    service: CourierSettingsService,
): CourierCredentialsView {
    return {
        courier,
        mode,
        complete: service.complete(courier, credentials),
        fields: COURIER_CREDENTIAL_FIELDS[courier].map(name => ({
            name,
            saved: !!credentials?.[name],
            value: COURIER_PUBLIC_FIELDS[courier].includes(name) ? (credentials?.[name] ?? null) : null,
        })),
    };
}

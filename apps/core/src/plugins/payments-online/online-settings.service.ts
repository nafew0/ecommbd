import {
    decryptSecret,
    defaultOnlinePaymentSettings,
    encryptSecret,
    GATEWAY_CREDENTIAL_FIELDS,
    GATEWAY_MODES,
    GATEWAY_PUBLIC_FIELDS,
    type GatewayCredentials,
    type GatewayMode,
    hasAllCredentials,
    type Keyring,
    mergeCredentials,
    ONLINE_GATEWAYS,
    type OnlineGateway,
    type OnlinePaymentSettings,
    parseKeyring,
    parseOnlinePaymentSettings,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Logger, RequestContext, RequestContextCacheService, SettingsStoreService } from '@vendure/core';
import { mergeDefaults } from '../bd-core';
import { loggerCtx, ONLINE_CREDENTIALS_KEY, ONLINE_SETTINGS_KEY, PAYMENTS_ONLINE_OPTIONS } from './constants';
import type { PaymentsOnlinePluginOptions } from './types';

/** Encrypted credentials: gateway → mode → token. */
type StoredCredentials = Partial<Record<OnlineGateway, Partial<Record<GatewayMode, string>>>>;

export interface GatewayCredentialsView {
    gateway: OnlineGateway;
    mode: GatewayMode;
    complete: boolean;
    /** Non-secret fields in full (the store ID); secrets only as whether they're saved. */
    fields: Array<{ name: string; saved: boolean; value: string | null }>;
}

export type UpdateResult<T> = { value: T; errors: [] } | { value: null; errors: SettingsFieldError[] };

/**
 * Online payment settings (on/off, sandbox or live, how long to wait for payment) and the gateways'
 * credentials, encrypted with SECRETS_KEYRING under a context naming the gateway and mode, so a
 * value can't be decrypted as another. Credentials never leave the server: staff see which are saved.
 */
@Injectable()
export class OnlineSettingsService {
    private readonly keyring: Keyring | null;

    constructor(
        @Inject(PAYMENTS_ONLINE_OPTIONS) options: PaymentsOnlinePluginOptions,
        private settingsStore: SettingsStoreService,
        private requestCache: RequestContextCacheService,
    ) {
        this.keyring = options.keyring ? parseKeyring(options.keyring) : null;
    }

    get keyringConfigured(): boolean {
        return !!this.keyring;
    }

    get(ctx: RequestContext): Promise<OnlinePaymentSettings> {
        return this.requestCache.get(ctx, ONLINE_SETTINGS_KEY, async () => {
            const stored = await this.settingsStore.get<OnlinePaymentSettings>(ctx, ONLINE_SETTINGS_KEY);
            return mergeDefaults(defaultOnlinePaymentSettings(), stored ?? undefined);
        });
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateResult<OnlinePaymentSettings>> {
        const parsed = parseOnlinePaymentSettings(input);
        if (!parsed.ok) return { value: null, errors: parsed.errors };
        const saved = await this.settingsStore.set(ctx, ONLINE_SETTINGS_KEY, parsed.settings);
        if (!saved.result) throw new Error(`Could not save online payment settings: ${saved.error}`);
        this.requestCache.set(ctx, ONLINE_SETTINGS_KEY, Promise.resolve(parsed.settings));
        return { value: parsed.settings, errors: [] };
    }

    private stored(ctx: RequestContext): Promise<StoredCredentials> {
        return this.requestCache.get(ctx, ONLINE_CREDENTIALS_KEY, async () => {
            return (await this.settingsStore.get<StoredCredentials>(ctx, ONLINE_CREDENTIALS_KEY)) ?? {};
        });
    }

    /** The decrypted credentials, or null when none are saved (or they can't be decrypted). */
    async credentials(
        ctx: RequestContext,
        gateway: OnlineGateway,
        mode: GatewayMode,
    ): Promise<GatewayCredentials | null> {
        const token = (await this.stored(ctx))[gateway]?.[mode];
        if (!token || !this.keyring) return null;
        try {
            return JSON.parse(
                decryptSecret(token, this.keyring, context(gateway, mode)),
            ) as GatewayCredentials;
        } catch (error) {
            // A rotated-away key or a value copied from another store: never the secret itself.
            Logger.error(`Could not decrypt ${gateway} ${mode} credentials: ${String(error)}`, loggerCtx);
            return null;
        }
    }

    async saveCredentials(
        ctx: RequestContext,
        gateway: OnlineGateway,
        mode: GatewayMode,
        input: unknown,
    ): Promise<UpdateResult<GatewayCredentialsView>> {
        if (!this.keyring) return { value: null, errors: [{ path: 'keyring', code: 'required' }] };
        const merged = mergeCredentials(gateway, await this.credentials(ctx, gateway, mode), input);
        if (!merged.ok) return { value: null, errors: merged.errors };
        const stored = { ...(await this.stored(ctx)) };
        stored[gateway] = {
            ...stored[gateway],
            [mode]: encryptSecret(JSON.stringify(merged.credentials), this.keyring, context(gateway, mode)),
        };
        const saved = await this.settingsStore.set(ctx, ONLINE_CREDENTIALS_KEY, stored);
        if (!saved.result) throw new Error(`Could not save ${gateway} credentials: ${saved.error}`);
        this.requestCache.set(ctx, ONLINE_CREDENTIALS_KEY, Promise.resolve(stored));
        return { value: view(gateway, mode, merged.credentials), errors: [] };
    }

    async credentialViews(ctx: RequestContext): Promise<GatewayCredentialsView[]> {
        const views: GatewayCredentialsView[] = [];
        for (const gateway of ONLINE_GATEWAYS) {
            for (const mode of GATEWAY_MODES) {
                views.push(view(gateway, mode, await this.credentials(ctx, gateway, mode)));
            }
        }
        return views;
    }
}

const context = (gateway: OnlineGateway, mode: GatewayMode) => `paymentsOnline:${gateway}:${mode}`;

function view(
    gateway: OnlineGateway,
    mode: GatewayMode,
    credentials: GatewayCredentials | null,
): GatewayCredentialsView {
    return {
        gateway,
        mode,
        complete: hasAllCredentials(gateway, credentials),
        fields: GATEWAY_CREDENTIAL_FIELDS[gateway].map(name => ({
            name,
            saved: !!credentials?.[name],
            value: GATEWAY_PUBLIC_FIELDS[gateway].includes(name) ? (credentials?.[name] ?? null) : null,
        })),
    };
}

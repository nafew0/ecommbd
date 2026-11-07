import {
    CircuitBreaker,
    createHttpClient,
    GATEWAY_BASE_URLS,
    type GatewayMode,
    hasAllCredentials,
    type HttpClient,
    type OnlineGateway,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Logger, type RequestContext } from '@vendure/core';
import { BkashTokenService } from './bkash-token.service';
import { loggerCtx, PAYMENTS_ONLINE_OPTIONS } from './constants';
import { bkashDriver } from './drivers/bkash';
import { sslcommerzDriver } from './drivers/sslcommerz';
import type { GatewayCall, GatewayDriver } from './drivers/types';
import { OnlineSettingsService } from './online-settings.service';
import type { PaymentsOnlinePluginOptions } from './types';

const DRIVERS = { sslcommerz: sslcommerzDriver, bkash: bkashDriver } satisfies Record<
    OnlineGateway,
    GatewayDriver
>;

/** After 5 failures in a row a gateway is hidden at checkout for 3 minutes, then tried again. */
const BREAKER = { failureThreshold: 5, cooldownMs: 3 * 60_000 };

export interface GatewayHandle<G extends OnlineGateway = OnlineGateway> {
    gateway: G;
    mode: GatewayMode;
    driver: (typeof DRIVERS)[G];
    call: GatewayCall;
}

/**
 * The gateways as the rest of the plugin sees them: which are usable now (on, credentials saved,
 * circuit closed), and a ready call (driver, address, credentials) for each. One HTTP client and one
 * circuit breaker for all gateways, keyed by host.
 */
@Injectable()
export class GatewayService implements OnApplicationShutdown {
    private readonly breaker = new CircuitBreaker(BREAKER);
    private readonly http: HttpClient;
    private readonly opened = new Set<string>();

    constructor(
        @Inject(PAYMENTS_ONLINE_OPTIONS) private options: PaymentsOnlinePluginOptions,
        private settings: OnlineSettingsService,
        private bkashTokens: BkashTokenService,
    ) {
        this.http = createHttpClient({
            connectTimeoutMs: 5_000,
            // bKash's calls set their own 30 seconds.
            timeoutMs: 20_000,
            circuitBreaker: this.breaker,
            // The gateways' addresses are fixed by us; tests point them at a local mock server.
            ssrfProtection: !options.baseUrls,
            userAgent: 'EcommBD-Payments',
        });
    }

    async onApplicationShutdown() {
        await this.http.close();
    }

    baseUrl(gateway: OnlineGateway, mode: GatewayMode): string {
        return this.options.baseUrls?.[gateway] ?? GATEWAY_BASE_URLS[gateway][mode];
    }

    /** The circuit for this gateway is open: it failed repeatedly and is paused. */
    paused(gateway: OnlineGateway, mode: GatewayMode): boolean {
        return this.breaker.state(new URL(this.baseUrl(gateway, mode)).host) === 'open';
    }

    /** The gateway, ready to call, when it's on and has complete credentials for its mode. */
    async handle<G extends OnlineGateway>(ctx: RequestContext, gateway: G): Promise<GatewayHandle<G> | null> {
        const settings = (await this.settings.get(ctx))[gateway];
        if (!settings.enabled) return null;
        return this.handleFor(ctx, gateway, settings.mode);
    }

    /** Same, for a given mode, whether or not the gateway is switched on (Test connection, reconciliation). */
    async handleFor<G extends OnlineGateway>(
        ctx: RequestContext,
        gateway: G,
        mode: GatewayMode,
    ): Promise<GatewayHandle<G> | null> {
        const credentials = await this.settings.credentials(ctx, gateway, mode);
        if (!hasAllCredentials(gateway, credentials)) return null;
        const call: GatewayCall = {
            http: this.http,
            baseUrl: this.baseUrl(gateway, mode),
            credentials: credentials!,
        };
        // bKash: one token for the store, shared by every process (at most 2 token calls an hour).
        if (gateway === 'bkash') call.token = renew => this.bkashTokens.token(call, renew);
        return { gateway, mode, driver: DRIVERS[gateway], call };
    }

    /** Offered at checkout: on, complete credentials, and not paused by the circuit breaker. */
    async available(ctx: RequestContext, gateway: OnlineGateway): Promise<boolean> {
        const handle = await this.handle(ctx, gateway);
        return !!handle && !this.paused(gateway, handle.mode);
    }

    /** Logs once when a gateway's circuit opens, so staff see "bKash is failing" in the logs and alerts. */
    noteFailure(gateway: OnlineGateway, mode: GatewayMode, error: unknown) {
        const host = new URL(this.baseUrl(gateway, mode)).host;
        if (this.paused(gateway, mode)) {
            if (!this.opened.has(host)) {
                this.opened.add(host);
                Logger.error(
                    `${gateway} failed repeatedly and is hidden at checkout for a few minutes: ${String(error)}`,
                    loggerCtx,
                );
            }
        } else {
            this.opened.delete(host);
            Logger.warn(`${gateway} call failed: ${String(error)}`, loggerCtx);
        }
    }
}

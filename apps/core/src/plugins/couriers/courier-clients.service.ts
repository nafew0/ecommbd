import {
    CircuitBreaker,
    COURIER_BASE_URLS,
    type Courier,
    type CourierMode,
    createHttpClient,
    type HttpClient,
} from '@ecommbd/shared';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import { COURIERS_OPTIONS } from './constants';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { steadfastDriver } from './drivers/steadfast';
import type { CourierCall, CourierDriver } from './drivers/types';
import type { CouriersPluginOptions } from './types';

const DRIVERS: Record<Courier, CourierDriver> = { steadfast: steadfastDriver, pathao: pathaoDriver };

const MINUTE = 60_000;

export interface CourierHandle {
    courier: Courier;
    mode: CourierMode;
    driver: CourierDriver;
    call: CourierCall;
}

/**
 * The couriers' APIs, ready to call: one HTTP client with a circuit breaker per courier host (after
 * 5 failures in a row, calls pause for 3 minutes: bookings wait and are tried again), the driver and
 * the credentials for the courier's mode.
 */
@Injectable()
export class CourierClients implements OnApplicationShutdown {
    readonly http: HttpClient;
    private readonly breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 3 * MINUTE });

    constructor(
        @Inject(COURIERS_OPTIONS) private options: CouriersPluginOptions,
        private settings: CourierSettingsService,
    ) {
        this.http = createHttpClient({
            timeoutMs: 20_000,
            circuitBreaker: this.breaker,
            ssrfProtection: !options.baseUrls,
            userAgent: 'EcommBD-Couriers',
        });
    }

    async onApplicationShutdown() {
        await this.http.close();
    }

    /** The courier, ready to call: on (unless a mode is asked for), with complete credentials. */
    async handle(ctx: RequestContext, courier: Courier, mode?: CourierMode): Promise<CourierHandle | null> {
        const settings = await this.settings.get(ctx);
        if (!mode && !settings[courier].enabled) return null;
        const useMode = mode ?? (await this.settings.mode(ctx, courier));
        const credentials = await this.settings.credentials(ctx, courier, useMode);
        if (!this.settings.complete(courier, credentials)) return null;
        return {
            courier,
            mode: useMode,
            driver: DRIVERS[courier],
            call: { http: this.http, baseUrl: this.baseUrl(courier, useMode), credentials: credentials! },
        };
    }

    /** Whether calls to the courier are paused after repeated failures ("waiting for <courier>"). */
    paused(courier: Courier, mode: CourierMode): boolean {
        return this.breaker.state(new URL(this.baseUrl(courier, mode)).host) === 'open';
    }

    async testConnection(ctx: RequestContext, courier: Courier, mode: CourierMode) {
        const handle = await this.handle(ctx, courier, mode);
        if (!handle) return { ok: false, message: ctx.translate('message.couriers.save-credentials-first') };
        return handle.driver.testConnection(handle.call);
    }

    private baseUrl(courier: Courier, mode: CourierMode): string {
        return this.options.baseUrls?.[courier] ?? COURIER_BASE_URLS[courier][mode];
    }
}

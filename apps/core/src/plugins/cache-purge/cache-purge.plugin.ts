import { PluginCommonModule, ScheduledTask, VendurePlugin } from '@vendure/core';
import { json, type NextFunction, type Request, type Response } from 'express';
import gql from 'graphql-tag';
import { CachePurgeService } from './cache-purge.service';
import { CachePurgeRequest, CacheStockState, CacheVitalSample } from './entities';
import { CACHE_OPTIONS, type CachePurgeOptions } from './options';
import { VitalsController, VitalsLimiter, VitalsResolver, VitalsService } from './vitals';

const parseBeacon = json({ limit: 512, type: 'application/json' });

/**
 * Reads a speed beacon's JSON body. A sample is about 110 bytes, so anything over 512 is refused
 * unread (413), and broken JSON gets a plain 400 rather than an error page.
 */
function readBeacon(req: Request, res: Response, next: NextFunction) {
    parseBeacon(req, res, (error?: { status?: number }) => {
        if (error) res.sendStatus(error.status === 413 ? 413 : 400);
        else next();
    });
}

/**
 * The storefront speed layer's core side (roadmap phase 17): purges Varnish and the storefront's
 * data cache when something shoppers see changes (cache-purge.service.ts), warms the cache after a
 * purge-all or a Varnish restart, and collects the anonymous speed beacon (vitals.ts).
 * Runbook: docs/runbooks/storefront-cache.md.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [CachePurgeRequest, CacheStockState, CacheVitalSample],
    providers: [
        CachePurgeService,
        VitalsService,
        VitalsLimiter,
        { provide: CACHE_OPTIONS, useFactory: () => CachePurgePlugin.options },
    ],
    controllers: [VitalsController],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                cacheDailyVitals: JSON!
            }
        `,
        resolvers: [VitalsResolver],
    },
    configuration: config => {
        config.apiOptions.middleware = [
            ...(config.apiOptions.middleware ?? []),
            { route: '/cache-metrics', beforeListen: true, handler: readBeacon },
        ];
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            // The worker delivers due purges four times a second; this Vendure task is the safety net that
            // still runs a round each minute if that timer ever stopped (promotion boundaries
            // included). Both run in the worker only, and deliveries take a per-channel lock.
            new ScheduledTask({
                id: 'storefront-promotion-boundaries',
                description: 'Deliver due storefront cache purges (promotion starts and ends included)',
                schedule: '* * * * *',
                execute: ({ injector }) => injector.get(CachePurgeService).tick(),
            }),
            new ScheduledTask({
                id: 'storefront-vitals-retention',
                description: 'Delete anonymous speed measurements older than 31 days',
                // Once a day, 03:37 UTC (the core runs in UTC), like bd-search's own clean-up.
                schedule: '37 3 * * *',
                execute: ({ injector }) => injector.get(VitalsService).cleanup(),
            }),
        ];
        return config;
    },
    compatibility: '^3.8.0',
})
export class CachePurgePlugin {
    static options: CachePurgeOptions;
    static init(options: CachePurgeOptions) {
        this.options = options;
        return this;
    }
}

import { PluginCommonModule, ScheduledTask, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';
import { json } from 'express';
import { CachePurgeRequest, CacheStockState, CacheVitalSample } from './entities';
import { CACHE_OPTIONS, CachePurgeOptions } from './options';
import { CachePurgeService } from './cache-purge.service';
import { VitalsController, VitalsResolver, VitalsService } from './vitals';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [CachePurgeRequest, CacheStockState, CacheVitalSample],
    providers: [
        CachePurgeService,
        VitalsService,
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
            { route: '/cache-metrics', beforeListen: true, handler: json({ limit: '2kb' }) },
        ];
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            new ScheduledTask({
                id: 'storefront-promotion-boundaries',
                description: 'Sweep due cache invalidations',
                schedule: '* * * * *',
                execute: ({ injector }) => injector.get(CachePurgeService).tick(),
            }),
            new ScheduledTask({
                id: 'storefront-vitals-retention',
                description: 'Delete expired anonymous speed measurements',
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

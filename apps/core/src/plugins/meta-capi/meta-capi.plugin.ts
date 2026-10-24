import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    type CustomFieldConfig,
    EventBus,
    LanguageCode,
    Logger,
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    Permission,
    PluginCommonModule,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import type { PurchaseTrigger } from '@ecommbd/shared';
import { BdCheckoutPlugin } from '../bd-checkout';
import { BdOrderConfirmedEvent } from '../bd-orders';
import { metaAdminApiExtensions, metaShopApiExtensions } from './api';
import { loggerCtx, META_OPTIONS } from './constants';
import { BdMetaEvent } from './entities';
import { MetaEventsController } from './events.controller';
import { MetaService } from './meta.service';
import { MetaSettingsService } from './meta-settings.service';
import { MetaAdminResolver, MetaShopResolver } from './resolvers';
import type { MetaCapiPluginOptions } from './types';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const hidden = { type: 'string' as const, nullable: true, public: false, readonly: true, internal: true };
const orderFields: CustomFieldConfig[] = [
    { ...hidden, name: 'metaFbp', length: 60, label: text('Meta browser ID', 'মেটা ব্রাউজার আইডি') },
    { ...hidden, name: 'metaFbc', length: 600, label: text('Meta click ID', 'মেটা ক্লিক আইডি') },
    {
        ...hidden,
        name: 'metaClientIp',
        length: 64,
        label: text('Shopper IP (kept 90 days)', 'ক্রেতার আইপি (৯০ দিন)'),
    },
    { ...hidden, name: 'metaUserAgent', length: 400, label: text('Shopper browser', 'ক্রেতার ব্রাউজার') },
];

const sendTask = new ScheduledTask({
    id: 'bd-send-meta-events',
    description: 'Send queued Meta events (Conversions API)',
    schedule: '* * * * *',
    async execute({ injector }) {
        return { sent: await injector.get(MetaService).send() };
    },
});

const retentionTask = new ScheduledTask({
    id: 'bd-meta-retention',
    description: 'Delete old Meta events and shopper IP addresses older than 90 days',
    schedule: '30 2 * * *',
    async execute({ injector }) {
        return { removed: await injector.get(MetaService).retention() };
    },
});

/**
 * Meta Pixel and Conversions API (roadmap phase 20): the storefront's events (with Meta's own script
 * when the store wants it, deduplicated by event ID) and Purchase from the server when the order
 * reaches the store's trigger (placed, confirmed or delivered), with hashed customer data and the
 * Meta cookies saved at checkout. An event log for staff, with "Send test event".
 */
@VendurePlugin({
    imports: [PluginCommonModule, BdCheckoutPlugin],
    entities: [BdMetaEvent],
    controllers: [MetaEventsController],
    providers: [
        { provide: META_OPTIONS, useFactory: () => MetaCapiPlugin.options },
        MetaSettingsService,
        MetaService,
    ],
    exports: [MetaService],
    shopApiExtensions: { schema: metaShopApiExtensions, resolvers: [MetaShopResolver] },
    adminApiExtensions: { schema: metaAdminApiExtensions, resolvers: [MetaAdminResolver] },
    configuration: config => {
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderFields];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), sendTask, retentionTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            metaCapi: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: { read: Permission.ReadSettings, write: Permission.SuperAdmin },
                },
                {
                    // Encrypted, and readable only by our own service: never through an API.
                    name: 'tokens',
                    readonly: true,
                    requiresPermission: { read: Permission.SuperAdmin, write: Permission.SuperAdmin },
                },
                {
                    name: 'status',
                    readonly: true,
                    requiresPermission: { read: Permission.ReadSettings, write: Permission.SuperAdmin },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class MetaCapiPlugin implements OnApplicationBootstrap {
    static options: MetaCapiPluginOptions = {};

    static init(options: MetaCapiPluginOptions): Type<MetaCapiPlugin> {
        MetaCapiPlugin.options = options;
        return MetaCapiPlugin;
    }

    constructor(
        private eventBus: EventBus,
        private meta: MetaService,
    ) {}

    onApplicationBootstrap() {
        const purchase =
            (trigger: PurchaseTrigger) =>
            (event: { ctx: Parameters<MetaService['purchase']>[0]; order: { id: string | number } }) =>
                void this.meta
                    .purchase(event.ctx, event.order.id, trigger)
                    .catch(error => Logger.error(`Could not queue Purchase: ${String(error)}`, loggerCtx));
        // Placed: at once, or for an online order once it's paid (phase 18).
        this.eventBus.ofType(OrderPlacedEvent).subscribe(event => {
            if (event.order.state !== 'AwaitingPayment') purchase('placed')(event);
        });
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(event => {
            if (event.fromState === 'AwaitingPayment' && event.toState !== 'Cancelled')
                purchase('placed')(event);
            if (event.toState === 'Delivered') purchase('delivered')(event);
        });
        this.eventBus.ofType(BdOrderConfirmedEvent).subscribe(event => purchase('confirmed')(event));
    }
}

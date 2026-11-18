import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    I18nService,
    Logger,
    OrderLineEvent,
    OrderPlacedEvent,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { registerStoreDefaults, updateStoreSettingsPermission } from '../bd-core';
import { costPermissionsStep } from './cost-defaults';
import { orderLineCostCustomFields, variantCostCustomFields } from './custom-fields';
import { loggerCtx, readCostPermission } from './constants';
import { CostService } from './cost.service';
import { CostSettingsService } from './cost-settings.service';
import { CostSnapshotService } from './cost-snapshot.service';
import { costAdminApiExtensions } from './cost.api';
import { CostAdminResolver } from './cost.resolver';
import { costTranslations } from './i18n';
import './types';

registerStoreDefaults(costPermissionsStep);

/**
 * Cost and profit (roadmap phase 51):
 * - a cost on each variation, hidden without ReadCost;
 * - a snapshot of that cost on each order line when the order is placed, and when a line is
 *   added to a placed order;
 * - profit for the order page and the order list;
 * - what the store pays the courier, for collecting COD, and to the payment gateway.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [CostSettingsService, CostSnapshotService, CostService],
    exports: [CostService],
    adminApiExtensions: {
        schema: costAdminApiExtensions,
        resolvers: [CostAdminResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            readCostPermission,
        ];
        config.customFields.ProductVariant = [
            ...(config.customFields.ProductVariant ?? []),
            ...variantCostCustomFields,
        ];
        config.customFields.OrderLine = [
            ...(config.customFields.OrderLine ?? []),
            ...orderLineCostCustomFields,
        ];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdCost: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: readCostPermission.Permission,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdCostPlugin implements OnApplicationBootstrap {
    constructor(
        private i18n: I18nService,
        private events: EventBus,
        private snapshots: CostSnapshotService,
    ) {}

    /**
     * The snapshot handlers never throw: a reporting feature must not stop a customer's order or
     * a staff edit. A failed snapshot leaves the line's cost empty, so its profit shows unknown.
     */
    onApplicationBootstrap() {
        this.i18n.addTranslation('en', costTranslations.en);
        this.i18n.addTranslation('bn', costTranslations.bn);
        this.events.registerBlockingEventHandler({
            id: 'bd-cost-order-placed',
            event: OrderPlacedEvent,
            handler: async event => {
                try {
                    await this.snapshots.onPlaced(event.ctx, event.order);
                } catch (error) {
                    Logger.error(
                        `Could not snapshot order cost, the order goes ahead and its profit shows unknown: ${error instanceof Error ? error.message : 'failed'}`,
                        loggerCtx,
                    );
                }
            },
        });
        this.events.registerBlockingEventHandler({
            id: 'bd-cost-order-line',
            event: OrderLineEvent,
            handler: async event => {
                try {
                    await this.snapshots.onLine(event.ctx, event.order, event.orderLine, event.type);
                } catch (error) {
                    Logger.error(
                        `Could not snapshot line cost, the edit goes ahead and its profit shows unknown: ${error instanceof Error ? error.message : 'failed'}`,
                        loggerCtx,
                    );
                }
            },
        });
    }
}

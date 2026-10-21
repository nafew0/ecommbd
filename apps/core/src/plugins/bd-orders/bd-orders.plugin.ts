import { type OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { I18nService, Permission, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults, updateStoreSettingsPermission } from '../bd-core';
import { createBdOrderProcess } from './bd-order-process';
import { CancelReasonInterceptor } from './cancel-reason.interceptor';
import { ORDER_PERMISSIONS } from './constants';
import { orderLineWorkflowCustomFields, orderWorkflowCustomFields } from './custom-fields';
import { orderTranslations } from './i18n';
import { OrderActionsService } from './order-actions.service';
import { autoCancelTask, orderPermissionsStep } from './order-defaults';
import { OrderListService } from './order-list.service';
import { OrderSettingsService } from './order-settings.service';
import { ordersAdminApiExtensions } from './orders.api';
import { BdOrderActionResultResolver, OrderInfoResolver, OrdersAdminResolver } from './orders.resolver';

registerStoreDefaults(orderPermissionsStep);

/**
 * The BD order workflow (roadmap phase 04):
 * - statuses New → Confirmed → Packed → Shipped → Delivered, plus Returned and Cancelled (with a
 *   reason), on Vendure's order process; every transition is in docs/decisions/order-states.md;
 * - order numbers (1001, or MF-1001) given when an order is placed;
 * - the confirmation queue: call attempts, call later, claims, possible duplicates, auto-cancel;
 * - order lists with status counts and filters, and the home widgets (Dhaka day);
 * - events for later phases, and the permissions ConfirmOrder, CancelOrder, PackOrder and
 *   ReadSalesFigures.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: APP_INTERCEPTOR, useClass: CancelReasonInterceptor },
        OrderSettingsService,
        OrderActionsService,
        OrderListService,
    ],
    adminApiExtensions: {
        schema: ordersAdminApiExtensions,
        resolvers: [OrdersAdminResolver, BdOrderActionResultResolver, OrderInfoResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            ...ORDER_PERMISSIONS,
        ];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderWorkflowCustomFields];
        config.customFields.OrderLine = [
            ...(config.customFields.OrderLine ?? []),
            ...orderLineWorkflowCustomFields,
        ];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), createBdOrderProcess()];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), autoCancelTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdOrders: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdOrdersPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', orderTranslations.en);
        this.i18n.addTranslation('bn', orderTranslations.bn);
    }
}

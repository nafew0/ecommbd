import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { MANUAL_ORDER_PERMISSIONS } from './constants';
import { orderLineManualCustomFields, orderManualCustomFields } from './custom-fields';
import { manualOrderTranslations } from './i18n';
import { ManualOrderService } from './manual-order.service';
import { draftCleanupTask, manualOrderPermissionsStep } from './manual-orders-defaults';
import { manualOrdersAdminApiExtensions } from './manual-orders.api';
import {
    BdManualOrderQuoteResultResolver,
    BdManualOrderResultResolver,
    ManualOrdersAdminResolver,
} from './manual-orders.resolver';
import { OrderEditService } from './order-edit.service';
import { BdOrderItemPriceStrategy } from './price-strategy';
import './types';

registerStoreDefaults(manualOrderPermissionsStep);

/**
 * Orders entered by staff and edits before shipping (roadmap phase 05):
 * - manual orders for Messenger, Facebook comment, phone, WhatsApp and walk-in customers, by
 *   phone number, with staff prices and discounts (permission-gated), delivery by the store's rules
 *   or a typed charge, and COD, already paid or an advance; created as New or Confirmed;
 * - editing items, prices, address, delivery and discount before shipping, with the COD amount
 *   following the new total and before/after in the order history;
 * - CreateManualOrder, EditOrder, OverridePrice, ApplyManualDiscount (up to 10%) and UnlimitedDiscount.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [ManualOrderService, OrderEditService],
    adminApiExtensions: {
        schema: manualOrdersAdminApiExtensions,
        resolvers: [ManualOrdersAdminResolver, BdManualOrderResultResolver, BdManualOrderQuoteResultResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            ...MANUAL_ORDER_PERMISSIONS,
        ];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderManualCustomFields];
        config.customFields.OrderLine = [
            ...(config.customFields.OrderLine ?? []),
            ...orderLineManualCustomFields,
        ];
        config.orderOptions.orderItemPriceCalculationStrategy = new BdOrderItemPriceStrategy();
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), draftCleanupTask];
        return config;
    },
    compatibility: '^3.8.0',
})
export class BdManualOrdersPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', manualOrderTranslations.en);
        this.i18n.addTranslation('bn', manualOrderTranslations.bn);
    }
}

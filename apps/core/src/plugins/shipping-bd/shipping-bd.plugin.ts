import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, Permission, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { productDeliveryCustomFields, variantDeliveryCustomFields } from './custom-fields';
import { deliveryEligibilityChecker, deliveryRateCalculator } from './delivery-operations';
import { DeliveryService } from './delivery.service';
import { shippingTranslations } from './i18n';
import { deliveryMethodsStep } from './shipping-defaults';
import { ShippingSettingsService } from './shipping-settings.service';
import { shippingAdminApiExtensions, shippingShopApiExtensions } from './shipping.api';
import { OrderDeliveryResolver, ShippingAdminResolver } from './shipping.resolver';
import './types';

registerStoreDefaults(deliveryMethodsStep);

/**
 * Bangladesh delivery charges (roadmap phase 07):
 * - zone rates from bd-geo (Dhaka city, Dhaka suburbs, outside Dhaka, optionally Chattogram city),
 *   with district and thana overrides;
 * - per-product charges (inside/outside Dhaka, free delivery, extra per item) and weight surcharges;
 * - free delivery above a subtotal, Express and Store pickup, coverage limits, the COD fee setting;
 * - one set of rules for the storefront and manual orders (Vendure's draft orders).
 * The rules are store settings edited in the merchant admin; the shipping methods only point at them.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [ShippingSettingsService, DeliveryService],
    // Payments (phase 08) read the zone and the COD fee setting.
    exports: [ShippingSettingsService, DeliveryService],
    shopApiExtensions: { schema: shippingShopApiExtensions, resolvers: [OrderDeliveryResolver] },
    adminApiExtensions: {
        schema: shippingAdminApiExtensions,
        resolvers: [OrderDeliveryResolver, ShippingAdminResolver],
    },
    configuration: config => {
        config.shippingOptions.shippingEligibilityCheckers = [
            ...config.shippingOptions.shippingEligibilityCheckers,
            deliveryEligibilityChecker,
        ];
        config.shippingOptions.shippingCalculators = [
            ...config.shippingOptions.shippingCalculators,
            deliveryRateCalculator,
        ];
        config.customFields.Product = [
            ...(config.customFields.Product ?? []),
            ...productDeliveryCustomFields,
        ];
        config.customFields.ProductVariant = [
            ...(config.customFields.ProductVariant ?? []),
            ...variantDeliveryCustomFields,
        ];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            shippingBd: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: Permission.UpdateShippingMethod,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class ShippingBdPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', shippingTranslations.en);
        this.i18n.addTranslation('bn', shippingTranslations.bn);
    }
}

import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, Permission, PluginCommonModule, type Type, VendurePlugin } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { checkoutAdminApiExtensions, checkoutShopApiExtensions } from './checkout.api';
import { createCheckoutGuard } from './checkout-guard';
import { CheckoutRateLimiter } from './checkout-rate-limiter';
import {
    CheckoutAdminResolver,
    CheckoutShopResolver,
    SetCustomerForOrderByPhoneResultResolver,
    SetOrderShippingAddressBdResultResolver,
} from './checkout.resolver';
import { CheckoutService } from './checkout.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { BD_CHECKOUT_PLUGIN_OPTIONS } from './constants';
import { customerCustomFields, orderCheckoutCustomFields } from './custom-fields';
import { CustomerSearchService } from './customer-search.service';
import { CustomerStatsService } from './customer-stats.service';
import { BdGuestCheckoutStrategy } from './guest-checkout.strategy';
import { GuestCustomerUserResolver, GuestOrderCustomerResolver } from './guest-view.resolver';
import { checkoutTranslations } from './i18n';
import { PhoneCustomerService } from './phone-customer.service';
import type { BdCheckoutPluginOptions } from './types';

/**
 * Phone-first customers and guest checkout (roadmap phase 03):
 * - `setCustomerForOrderByPhone` and `setOrderShippingAddressBD` in the Shop API, with typed,
 *   translated errors and rate limits; no email needed anywhere;
 * - one customer per phone (custom field `phone`), with order stats kept current;
 * - no payment without a valid phone and a district/thana address;
 * - guests never see a linked account's data;
 * - the customer list searched by phone, and checkout settings, in the Admin API.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: BD_CHECKOUT_PLUGIN_OPTIONS, useFactory: () => BdCheckoutPlugin.options },
        CheckoutRateLimiter,
        CheckoutSettingsService,
        PhoneCustomerService,
        CheckoutService,
        CustomerStatsService,
        CustomerSearchService,
    ],
    shopApiExtensions: {
        schema: checkoutShopApiExtensions,
        resolvers: [
            CheckoutShopResolver,
            SetCustomerForOrderByPhoneResultResolver,
            SetOrderShippingAddressBdResultResolver,
            GuestOrderCustomerResolver,
            GuestCustomerUserResolver,
        ],
    },
    adminApiExtensions: {
        schema: checkoutAdminApiExtensions,
        resolvers: [CheckoutAdminResolver],
    },
    configuration: config => {
        config.customFields.Customer = [...(config.customFields.Customer ?? []), ...customerCustomFields];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderCheckoutCustomFields];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), createCheckoutGuard()];
        config.orderOptions.guestCheckoutStrategy = new BdGuestCheckoutStrategy();
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            bdCheckout: [
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
export class BdCheckoutPlugin implements OnApplicationBootstrap {
    static options: BdCheckoutPluginOptions;

    static init(options: BdCheckoutPluginOptions): Type<BdCheckoutPlugin> {
        this.options = options;
        return BdCheckoutPlugin;
    }

    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', checkoutTranslations.en);
        this.i18n.addTranslation('bn', checkoutTranslations.bn);
    }
}

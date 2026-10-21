import { type OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, Permission, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { ShippingBdPlugin } from '../shipping-bd';
import { verifyPaymentPermission } from './constants';
import { orderPaymentCustomFields, paymentCustomFields } from './custom-fields';
import { paymentTranslations } from './i18n';
import { PaymentChecksService } from './payment-checks.service';
import { paymentMethodsStep, paymentPermissionsStep, staffPaymentMethodStep } from './payment-defaults';
import { codPaymentHandler, manualMfsPaymentHandler, staffPaymentHandler } from './payment-handlers';
import {
    bdPaymentProcess,
    codEligibilityChecker,
    mfsEligibilityChecker,
    staffEligibilityChecker,
} from './payment-operations';
import { PaymentRulesService } from './payment-rules.service';
import { PaymentSettingsService } from './payment-settings.service';
import { paymentsAdminApiExtensions, paymentsShopApiExtensions } from './payments.api';
import {
    BdPaymentCheckResultResolver,
    BdRefundResultResolver,
    PaymentsAdminResolver,
    PaymentsShopResolver,
} from './payments.resolver';
import './types';

registerStoreDefaults(paymentMethodsStep, paymentPermissionsStep, staffPaymentMethodStep);

/**
 * Payments the way small BD merchants take them (roadmap phase 08):
 * - cash on delivery: authorized at checkout, settled on delivery; limits by order total and zone;
 * - bKash, Nagad and Rocket "Send Money" with the sender number and transaction ID, checked by
 *   staff in the Verify payments queue; a TrxID can pay one order only;
 * - a partial advance (delivery charge, fixed or a percentage) paid first, the rest by COD;
 * - the COD fee from the delivery settings as its own order line;
 * - refund records, needed before cancelling an order with money received;
 * - the VerifyPayment permission.
 */
@VendurePlugin({
    imports: [PluginCommonModule, ShippingBdPlugin],
    providers: [PaymentSettingsService, PaymentRulesService, PaymentChecksService],
    shopApiExtensions: { schema: paymentsShopApiExtensions, resolvers: [PaymentsShopResolver] },
    adminApiExtensions: {
        schema: paymentsAdminApiExtensions,
        resolvers: [PaymentsAdminResolver, BdPaymentCheckResultResolver, BdRefundResultResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            verifyPaymentPermission,
        ];
        config.paymentOptions.paymentMethodHandlers = [
            ...config.paymentOptions.paymentMethodHandlers,
            codPaymentHandler,
            manualMfsPaymentHandler,
            staffPaymentHandler,
        ];
        config.paymentOptions.paymentMethodEligibilityCheckers = [
            ...(config.paymentOptions.paymentMethodEligibilityCheckers ?? []),
            codEligibilityChecker,
            mfsEligibilityChecker,
            staffEligibilityChecker,
        ];
        config.paymentOptions.process = [...(config.paymentOptions.process ?? []), bdPaymentProcess];
        config.customFields.Payment = [...(config.customFields.Payment ?? []), ...paymentCustomFields];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderPaymentCustomFields];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            paymentsBd: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: Permission.UpdatePaymentMethod,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class PaymentsBdPlugin implements OnApplicationBootstrap {
    constructor(private i18n: I18nService) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', paymentTranslations.en);
        this.i18n.addTranslation('bn', paymentTranslations.bn);
    }
}

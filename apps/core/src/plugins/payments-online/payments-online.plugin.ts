import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    I18nService,
    Permission,
    PluginCommonModule,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { BdOrdersPlugin } from '../bd-orders';
import { BdTrackingPlugin } from '../bd-tracking';
import { PaymentsBdPlugin } from '../payments-bd';
import { onlineAdminApiExtensions, onlineShopApiExtensions } from './api';
import { BdPaymentAttempt } from './attempt.entity';
import { managePaymentsPermission, PAYMENTS_ONLINE_OPTIONS } from './constants';
import { onlineMethodsStep, onlinePermissionsStep } from './defaults';
import { GatewayService } from './gateway.service';
import { onlinePaymentTranslations } from './i18n';
import { OnlinePaymentService } from './online-payment.service';
import { OnlineSettingsService } from './online-settings.service';
import {
    BdOrderPlacedStrategy,
    BdStockAllocationStrategy,
    createOnlineOrderProcess,
    createOnlinePaymentProcess,
} from './order-operations';
import { PayController } from './pay.controller';
import { onlineEligibilityChecker, onlinePaymentHandler } from './payment-handler';
import {
    BdPaymentReviewResultResolver,
    OnlineAdminResolver,
    OnlineShopOptionsResolver,
    OnlineTrackedOrderResolver,
} from './resolvers';
import type { PaymentsOnlinePluginOptions } from './types';

registerStoreDefaults(onlineMethodsStep, onlinePermissionsStep);

let service: OnlinePaymentService | undefined;

const reconcileTask = new ScheduledTask({
    id: 'bd-reconcile-online-payments',
    description: 'Ask the payment gateways about unfinished online payments',
    schedule: '*/5 * * * *',
    async execute({ injector }) {
        return { checked: await injector.get(OnlinePaymentService).reconcile() };
    },
});

const expireTask = new ScheduledTask({
    id: 'bd-expire-online-payments',
    description: 'Cancel online orders not paid in time, releasing their stock',
    schedule: '*/5 * * * *',
    async execute({ injector }) {
        return { cancelled: await injector.get(OnlinePaymentService).expire() };
    },
});

/**
 * Online payments (roadmap phase 18): SSLCommerz and bKash tokenized checkout. An online order is
 * placed unpaid (AwaitingPayment, with a Pending payment), holds its stock and waits outside the
 * confirmation queue; only the gateway's server-to-server confirmation marks it paid. Every attempt
 * is reconciled for a week, so no payment is lost; unpaid orders expire; money that can't go to its
 * order is held for staff (late, duplicate, risky, wrong amount). Credentials are encrypted per store.
 */
@VendurePlugin({
    imports: [PluginCommonModule, PaymentsBdPlugin, BdOrdersPlugin, BdTrackingPlugin],
    entities: [BdPaymentAttempt],
    controllers: [PayController],
    providers: [
        { provide: PAYMENTS_ONLINE_OPTIONS, useFactory: () => PaymentsOnlinePlugin.options },
        OnlineSettingsService,
        GatewayService,
        OnlinePaymentService,
    ],
    exports: [OnlinePaymentService],
    shopApiExtensions: {
        schema: onlineShopApiExtensions,
        resolvers: [OnlineShopOptionsResolver, OnlineTrackedOrderResolver],
    },
    adminApiExtensions: {
        schema: onlineAdminApiExtensions,
        resolvers: [OnlineAdminResolver, BdPaymentReviewResultResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            managePaymentsPermission,
        ];
        config.paymentOptions.paymentMethodHandlers = [
            ...config.paymentOptions.paymentMethodHandlers,
            onlinePaymentHandler,
        ];
        config.paymentOptions.paymentMethodEligibilityCheckers = [
            ...(config.paymentOptions.paymentMethodEligibilityCheckers ?? []),
            onlineEligibilityChecker,
        ];
        config.paymentOptions.process = [
            ...(config.paymentOptions.process ?? []),
            createOnlinePaymentProcess((ctx, payment, order) =>
                service!.recordFirstAttempt(ctx, payment, order),
            ),
        ];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), createOnlineOrderProcess()];
        config.orderOptions.orderPlacedStrategy = new BdOrderPlacedStrategy();
        config.orderOptions.stockAllocationStrategy = new BdStockAllocationStrategy();
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), reconcileTask, expireTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            paymentsOnline: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: Permission.UpdatePaymentMethod,
                    },
                },
                {
                    // Encrypted, and readable only by our own service: never through an API.
                    name: 'credentials',
                    readonly: true,
                    requiresPermission: { read: Permission.SuperAdmin, write: Permission.SuperAdmin },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class PaymentsOnlinePlugin implements OnApplicationBootstrap {
    static options: PaymentsOnlinePluginOptions = {};

    static init(options: PaymentsOnlinePluginOptions): Type<PaymentsOnlinePlugin> {
        PaymentsOnlinePlugin.options = options;
        return PaymentsOnlinePlugin;
    }

    constructor(
        private i18n: I18nService,
        private payments: OnlinePaymentService,
    ) {}

    onApplicationBootstrap() {
        service = this.payments;
        this.i18n.addTranslation('en', onlinePaymentTranslations.en);
        this.i18n.addTranslation('bn', onlinePaymentTranslations.bn);
    }
}

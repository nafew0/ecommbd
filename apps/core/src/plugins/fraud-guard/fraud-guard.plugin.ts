import { type OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, I18nService, Logger, OrderPlacedEvent, Permission, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults, updateStoreSettingsPermission } from '../bd-core';
import { registerPaymentRiskCheck } from '../payments-bd';
import { fraudAdminApiExtensions, fraudShopApiExtensions } from './api';
import { BlockListService } from './block-list.service';
import { loggerCtx, readRiskPermission } from './constants';
import { orderFraudCustomFields } from './custom-fields';
import { fraudPermissionsStep, incompleteExpiryTask } from './defaults';
import { BdBlockEntry, BdIncompleteCheckout, BdOtpCode } from './entities';
import { FraudSettingsService } from './fraud-settings.service';
import { fraudTranslations } from './i18n';
import { IncompleteCheckoutService } from './incomplete-checkout.service';
import { createFraudGuard } from './order-guard';
import { OtpService } from './otp.service';
import {
    CustomerBlockResolver,
    FraudAdminResolver,
    FraudShopResolver,
    IncompleteCheckoutFieldResolver,
    OrderRiskResolver,
} from './resolvers';
import { RiskService } from './risk.service';
import './types';

registerStoreDefaults(fraudPermissionsStep);

/** Set when the plugin starts; the payment rules ask through these (phase 08's hook). */
let services: { blockList: BlockListService; risk: RiskService; otp: OtpService } | undefined;

registerPaymentRiskCheck({
    async codBlocked(ctx, order) {
        if (!services || ctx.apiType !== 'shop') return false;
        return Boolean(
            (await services.blockList.find(ctx, 'phone', order.customer?.customFields?.phone)) ||
                (await services.blockList.find(ctx, 'ip', ctx.req?.ip)),
        );
    },
    async risky(ctx, order) {
        return services ? services.risk.isRisky(ctx, order) : false;
    },
    async codNeedsCode(ctx, order) {
        return services ? services.otp.needed(ctx, order) : false;
    },
});

/**
 * Incomplete orders and fake-order protection (roadmap phase 11):
 * - incomplete checkouts saved as the shopper types, recovered or converted by a later order,
 *   personal data deleted after 30 days;
 * - a block list of phones and (temporary) IPs, refused politely before payment;
 * - orders per phone per day, and an optional "already ordered" window;
 * - an own-store risk score with reasons, kept on each order for the confirmation queue;
 * - verification codes by SMS for COD (all, first-time phones, or risky orders).
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdIncompleteCheckout, BdBlockEntry, BdOtpCode],
    providers: [FraudSettingsService, BlockListService, RiskService, OtpService, IncompleteCheckoutService],
    shopApiExtensions: { schema: fraudShopApiExtensions, resolvers: [FraudShopResolver] },
    adminApiExtensions: {
        schema: fraudAdminApiExtensions,
        resolvers: [FraudAdminResolver, IncompleteCheckoutFieldResolver, OrderRiskResolver, CustomerBlockResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [...(config.authOptions.customPermissions ?? []), readRiskPermission];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderFraudCustomFields];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), createFraudGuard()];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), incompleteExpiryTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            fraudGuard: [
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
export class FraudGuardPlugin implements OnApplicationBootstrap {
    constructor(
        private i18n: I18nService,
        private eventBus: EventBus,
        private blockList: BlockListService,
        private risk: RiskService,
        private otp: OtpService,
        private incomplete: IncompleteCheckoutService,
    ) {}

    onApplicationBootstrap() {
        this.i18n.addTranslation('en', fraudTranslations.en);
        this.i18n.addTranslation('bn', fraudTranslations.bn);
        services = { blockList: this.blockList, risk: this.risk, otp: this.otp };
        this.eventBus.ofType(OrderPlacedEvent).subscribe(({ ctx, order }) => {
            void Promise.all([this.risk.store(ctx, order), this.incomplete.onOrderPlaced(ctx, order)]).catch(error =>
                Logger.error(`Could not record risk or recover a checkout: ${String(error)}`, loggerCtx),
            );
        });
    }
}

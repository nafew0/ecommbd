import type { OnlineGateway } from '@ecommbd/shared';
import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'PaymentsOnlinePlugin';

export const PAYMENTS_ONLINE_OPTIONS = Symbol('PAYMENTS_ONLINE_OPTIONS');

/** Keys in Vendure's settings store. Credentials are encrypted and never readable through an API. */
export const ONLINE_SETTINGS_KEY = 'paymentsOnline.settings';
export const ONLINE_CREDENTIALS_KEY = 'paymentsOnline.credentials';

export const ONLINE_HANDLER_CODE = 'bd-online';
export const ONLINE_CHECKER_CODE = 'bd-online-eligibility';

/** The payment methods every store gets (store defaults), by gateway. */
export const ONLINE_METHOD_CODES: Record<OnlineGateway, string> = {
    sslcommerz: 'bd-sslcommerz',
    bkash: 'bd-bkash-online',
};

/** Where the gateways send shoppers and notifications: `<STOREFRONT_URL>/bd-pay/…` (proxied to the core). */
export const PAY_ROUTE = 'bd-pay';

/** Order history entry for every gateway outcome and staff decision. */
export const ONLINE_PAYMENT_HISTORY_TYPE = 'BD_ONLINE_PAYMENT' as const;

export const managePaymentsPermission = new PermissionDefinition({
    name: 'ManagePayments',
    description: 'Accept or refund online payments held for review (late, duplicate, risky)',
});

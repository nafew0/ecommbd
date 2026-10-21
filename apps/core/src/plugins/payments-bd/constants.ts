import type { MfsProvider } from '@ecommbd/shared';
import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'PaymentsBdPlugin';

/** Key in Vendure's settings store. */
export const PAYMENT_SETTINGS_KEY = 'paymentsBd.settings';

export const COD_HANDLER_CODE = 'bd-cod';
export const MFS_HANDLER_CODE = 'bd-manual-mfs';
export const COD_CHECKER_CODE = 'bd-cod-eligibility';
export const MFS_CHECKER_CODE = 'bd-mfs-eligibility';

/** The payment methods every store gets (store defaults), by code. */
export const COD_METHOD_CODE = 'bd-cod';
export const MFS_METHOD_CODES: Record<MfsProvider, string> = {
    bkash: 'bd-bkash',
    nagad: 'bd-nagad',
    rocket: 'bd-rocket',
};

/** The COD fee is an order surcharge with this SKU (phase 07's setting). */
export const COD_FEE_SKU = 'BD-COD-FEE';

/** Order history entry when staff verify or reject a mobile banking payment. */
export const PAYMENT_CHECK_HISTORY_TYPE = 'BD_PAYMENT_CHECK' as const;

export const verifyPaymentPermission = new PermissionDefinition({
    name: 'VerifyPayment',
    description: 'Verify or reject mobile banking payments, and record refunds',
});

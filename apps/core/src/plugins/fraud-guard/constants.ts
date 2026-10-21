import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'FraudGuardPlugin';

/** Key in Vendure's settings store. */
export const FRAUD_SETTINGS_KEY = 'fraudGuard.settings';

/** Staff who may see why an order looks risky (the order staff role has it). */
export const readRiskPermission = new PermissionDefinition({
    name: 'ReadRisk',
    description: 'See the risk score of orders and its reasons',
});

const MINUTE = 60_000;

/** Incomplete checkouts are saved as the shopper types (debounced): plenty for that, little for a script. */
export const PROGRESS_RATE_LIMITS = {
    perSession: { limit: 60, windowMs: 10 * MINUTE },
    perPhone: { limit: 30, windowMs: 10 * MINUTE },
};

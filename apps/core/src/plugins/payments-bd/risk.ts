import type { Order, RequestContext } from '@vendure/core';

/**
 * What fraud protection (phase 11) tells payments about an order's phone. Registered at module
 * load, like store defaults; with none registered, nobody is blocked or risky.
 */
export interface PaymentRiskCheck {
    /** COD is not offered (the shopper sees the generic message, never "you are blocked"). */
    codBlocked(ctx: RequestContext, order: Order): Promise<boolean>;
    /** The "risky orders" advance scope applies. */
    risky(ctx: RequestContext, order: Order): Promise<boolean>;
    /** COD waits for the shopper's verification code (phase 11), sent by SMS. */
    codNeedsCode?(ctx: RequestContext, order: Order): Promise<boolean>;
}

const checks: PaymentRiskCheck[] = [];

export function registerPaymentRiskCheck(check: PaymentRiskCheck): void {
    checks.push(check);
}

export async function codBlocked(ctx: RequestContext, order: Order): Promise<boolean> {
    for (const check of checks) {
        if (await check.codBlocked(ctx, order)) return true;
    }
    return false;
}

export async function risky(ctx: RequestContext, order: Order): Promise<boolean> {
    for (const check of checks) {
        if (await check.risky(ctx, order)) return true;
    }
    return false;
}

export async function codNeedsCode(ctx: RequestContext, order: Order): Promise<boolean> {
    for (const check of checks) {
        if (await check.codNeedsCode?.(ctx, order)) return true;
    }
    return false;
}

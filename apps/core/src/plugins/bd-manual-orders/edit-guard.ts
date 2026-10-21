import type { Order, RequestContext } from '@vendure/core';

/**
 * Something that stops an order from being edited, e.g. a courier booking (phase 19 registers
 * "cancel the courier booking first"). Returns null when the order may be edited.
 */
export type OrderEditGuard = (ctx: RequestContext, order: Order) => Promise<'COURIER_BOOKED' | null>;

const guards: OrderEditGuard[] = [];

export function registerOrderEditGuard(guard: OrderEditGuard): void {
    guards.push(guard);
}

export async function editBlockedBy(ctx: RequestContext, order: Order): Promise<'COURIER_BOOKED' | null> {
    for (const guard of guards) {
        const reason = await guard(ctx, order);
        if (reason) return reason;
    }
    return null;
}

import { type ID, type Order, type RequestContext, VendureEvent } from '@vendure/core';

/** Who did it: the staff member, or null for the system (the auto-cancel task). */
export interface ActingStaff {
    administratorId: ID | null;
    name: string | null;
}

/**
 * BD order events for later phases (SMS in 10, Meta in 20, couriers in 19). They fire for every
 * path (our admin, Vendure's Dashboard), after the transaction commits, and never for imported
 * orders.
 */
abstract class BdOrderEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public order: Order,
        public staff: ActingStaff,
    ) {
        super();
    }
}

export class BdOrderConfirmedEvent extends BdOrderEvent {}
export class BdOrderPackedEvent extends BdOrderEvent {}
export class BdOrderReturnedEvent extends BdOrderEvent {}
export class BdOrderCancelledWithReasonEvent extends BdOrderEvent {
    get reason() {
        return this.order.customFields.cancelReason ?? null;
    }
    get note() {
        return this.order.customFields.cancelNote ?? null;
    }
}

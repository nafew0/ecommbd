import type { ID, RequestContext } from '@vendure/core';

/** An order's parcel with a courier, for stickers, invoices and the tracking page. */
export interface ShipmentInfo {
    courier: string;
    consignmentId: string;
    trackingCode: string | null;
    /** The courier's own tracking page. */
    trackingUrl: string | null;
}

export type ShipmentInfoSource = (ctx: RequestContext, orderId: ID) => Promise<ShipmentInfo | null>;

let source: ShipmentInfoSource | null = null;

/** Couriers (phase 19) tell printing and tracking about an order's parcel, without either knowing couriers. */
export function registerShipmentInfo(next: ShipmentInfoSource): void {
    source = next;
}

export function shipmentInfo(ctx: RequestContext, orderId: ID): Promise<ShipmentInfo | null> {
    return source ? source(ctx, orderId) : Promise.resolve(null);
}

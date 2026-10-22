import { RequestContext, VendureEvent } from '@vendure/core';

/** Internal event only; HTTP headers cannot request or suppress invalidation. */
export class StorefrontChangedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public tags: string[],
        public all = false,
    ) {
        super();
    }
}

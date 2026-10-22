import { RequestContext, VendureEvent } from '@vendure/core';

// Internal contexts only: a client header cannot suppress integrations. Asset processing and
// slug registration still run. External catalog listeners should skip these contexts and
// invalidate once on WooImportCompletedEvent instead.
const importing = new WeakSet<RequestContext>();
export function markWooImportContext(ctx: RequestContext) {
    importing.add(ctx);
}
export function isWooImportContext(ctx: RequestContext) {
    return importing.has(ctx);
}
export class WooImportCompletedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly sourceId: number,
        public readonly runId: number,
    ) {
        super();
    }
}

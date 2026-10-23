import { RequestContext, VendureEvent } from '@vendure/core';

/**
 * "This work is a WooCommerce import": listeners that would send something (SMS, emails, Meta
 * events) or purge caches skip it, and react once to {@link WooImportCompletedEvent} instead.
 *
 * The mark is a symbol-keyed property on the context itself, not a set of contexts. Vendure hands
 * event subscribers and transactions a *copy* of the context (`ctx.copy()` is an
 * `Object.assign`), and a copy carries the symbol along, where a WeakSet lookup would miss it.
 * Only server code can set it: a symbol never arrives from a client, and `ctx.serialize()` (for
 * jobs) leaves it out, so a job started during an import is not quiet unless it marks itself.
 */
const IMPORTING = Symbol('ecommbd.wooImport');

type MarkedContext = RequestContext & { [IMPORTING]?: true };

export function markWooImportContext(ctx: RequestContext) {
    (ctx as MarkedContext)[IMPORTING] = true;
}

/** True for an importer's context, and for every copy Vendure makes of it. */
export function isWooImportContext(ctx: RequestContext | undefined): boolean {
    return !!ctx && (ctx as MarkedContext)[IMPORTING] === true;
}

/**
 * Published once an import (or catch-up) has finished, after the search index has been rebuilt,
 * so listeners can refresh everything at once (one cache purge-all, then the warm-up).
 */
export class WooImportCompletedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly sourceId: number,
        public readonly runId: number,
    ) {
        super();
    }
}

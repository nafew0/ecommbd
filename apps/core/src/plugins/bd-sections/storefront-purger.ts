import { Injectable } from '@nestjs/common';
import { EventBus, RequestContext } from '@vendure/core';
import { StorefrontChangedEvent } from '../cache-purge/events';

/** The speed layer persists this event before doing any external I/O. */
@Injectable()
export class StorefrontPurger {
    constructor(private events: EventBus) {}
    purge(ctx: RequestContext, tags: string[], all = false) {
        return this.events.publish(new StorefrontChangedEvent(ctx, tags, all));
    }
}

import { parseBdMobile } from '@ecommbd/shared';
import { Args, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Order, Permission, RequestContext } from '@vendure/core';
import { TrackingRateLimitedError } from './errors';
import { TrackingRateLimiter } from './rate-limiter';
import { TrackingService } from './tracking.service';

/** The shopper's address: behind Nginx (and the storefront) Express' `trustProxy` gives the real one. */
const clientIp = (ctx: RequestContext) => ctx.req?.ip ?? 'unknown';

@Resolver()
export class TrackingShopResolver {
    constructor(
        private tracking: TrackingService,
        private limiter: TrackingRateLimiter,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async bdTrackOrder(@Ctx() ctx: RequestContext, @Args() args: { orderNumber: string; phone: string }) {
        // Every attempt counts, found or not, so numbers can't be tried one after another.
        let wait = await this.limiter.hit(`track:ip:${clientIp(ctx)}`, this.limiter.rules.perIp);
        const phone = parseBdMobile(args.phone.slice(0, 40));
        if (!wait && phone.ok) {
            wait = await this.limiter.hit(`track:phone:${phone.phone.e164}`, this.limiter.rules.perPhone);
        }
        if (wait) throw new TrackingRateLimitedError(wait);
        return this.tracking.byNumberAndPhone(ctx, args.orderNumber, args.phone);
    }

    @Query()
    @Allow(Permission.Public)
    async bdTrackOrderByToken(@Ctx() ctx: RequestContext, @Args() args: { token: string }) {
        const wait = await this.limiter.hit(`track:token:${clientIp(ctx)}`, this.limiter.rules.tokenPerIp);
        if (wait) throw new TrackingRateLimitedError(wait);
        return this.tracking.byToken(ctx, args.token);
    }
}

@Resolver('Order')
export class TrackingOrderResolver {
    constructor(private tracking: TrackingService) {}

    /** Whoever may read the order (Vendure's order-by-code rules) may have its tracking link. */
    @ResolveField()
    bdTrackingToken(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.tracking.tokenFor(ctx, order);
    }
}

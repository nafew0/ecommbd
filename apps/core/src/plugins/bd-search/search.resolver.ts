import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import { manageContentPermission } from '../bd-content/constants';
import { SearchRateLimitedError } from './errors';
import { SearchRateLimiter } from './rate-limiter';
import type { SearchSort } from './search-engine';
import { BdSearchService, type SearchInput } from './search.service';

const SORTS: Record<string, SearchSort> = {
    RELEVANCE: 'relevance',
    FEATURED: 'featured',
    NEWEST: 'newest',
    PRICE_ASC: 'price-asc',
    PRICE_DESC: 'price-desc',
    POPULAR: 'popular',
};

/** The shopper's address: behind Nginx (and the storefront) Express' `trustProxy` gives the real one. */
function clientIp(ctx: RequestContext): string {
    return ctx.req?.ip ?? 'unknown';
}

@Resolver()
export class SearchShopResolver {
    constructor(
        private search: BdSearchService,
        private limiter: SearchRateLimiter,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async bdSearch(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: Omit<SearchInput, 'sort'> & { sort?: string } },
    ) {
        const wait = await this.limiter.hit(`search:ip:${clientIp(ctx)}`, this.limiter.rules.search);
        if (wait) throw new SearchRateLimitedError(wait);
        const { sort, ...input } = args.input;
        return this.search.search(ctx, { ...input, sort: sort ? SORTS[sort] : undefined }).then(outcome => ({
            ...outcome,
            totalItems: outcome.total,
        }));
    }

    @Query()
    @Allow(Permission.Public)
    async bdSearchSuggestions(@Ctx() ctx: RequestContext, @Args() args: { term: string }) {
        const wait = await this.limiter.hit(`suggest:ip:${clientIp(ctx)}`, this.limiter.rules.suggest);
        if (wait) throw new SearchRateLimitedError(wait);
        return this.search.suggest(ctx, args.term);
    }
}

@Resolver()
export class SearchAdminResolver {
    constructor(private search: BdSearchService) {}

    @Query()
    @Allow(manageContentPermission.Permission)
    bdSearchSettings(@Ctx() ctx: RequestContext) {
        return this.search.settings(ctx);
    }

    @Query()
    @Allow(manageContentPermission.Permission)
    bdSearchMisses(@Ctx() ctx: RequestContext, @Args() args: { days?: number; take?: number }) {
        return this.search.misses(ctx, args.days ?? undefined, args.take ?? undefined);
    }

    @Transaction()
    @Mutation()
    @Allow(manageContentPermission.Permission)
    updateBdSearchSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.search.updateSettings(ctx, args.input);
    }
}

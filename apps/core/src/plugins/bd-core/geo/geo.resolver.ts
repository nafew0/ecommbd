import { dataVersion } from '@ecommbd/bd-geo';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { districtList, thanaList, toGeoLanguage } from './geo-lists';

/** Public, read-only place lists. Used in both the Shop and Admin APIs. */
@Resolver()
export class BdGeoResolver {
    @Query()
    @Allow(Permission.Public)
    bdDistricts(@Ctx() ctx: RequestContext, @Args() args: { lang?: string }) {
        return districtList(toGeoLanguage(args.lang ?? ctx.languageCode));
    }

    @Query()
    @Allow(Permission.Public)
    bdThanas(@Ctx() ctx: RequestContext, @Args() args: { districtId: string; lang?: string }) {
        return thanaList(args.districtId, toGeoLanguage(args.lang ?? ctx.languageCode));
    }

    @Query()
    @Allow(Permission.Public)
    bdGeoDataVersion() {
        return dataVersion;
    }
}

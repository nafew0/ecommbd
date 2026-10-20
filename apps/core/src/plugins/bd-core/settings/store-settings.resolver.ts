import { toPublicStoreSettings } from '@ecommbd/shared';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import { updateStoreSettingsPermission } from '../constants';
import { StoreSettingsService } from './store-settings.service';

@Resolver()
export class BdStoreSettingsAdminResolver {
    constructor(private service: StoreSettingsService) {}

    @Query()
    @Allow(Permission.ReadSettings)
    async bdStoreSettings(@Ctx() ctx: RequestContext) {
        const settings = await this.service.get(ctx);
        return {
            settings,
            logo: await this.service.findAsset(ctx, settings.profile.logoAssetId),
            favicon: await this.service.findAsset(ctx, settings.profile.faviconAssetId),
            history: await this.service.history(ctx),
            warnings: this.service.warnings(ctx),
        };
    }

    @Mutation()
    @Transaction()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdStoreSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.service.update(ctx, args.input);
    }
}

/** What the storefront may see: `toPublicStoreSettings` drops private fields before anything else. */
@Resolver()
export class BdStoreSettingsShopResolver {
    constructor(private service: StoreSettingsService) {}

    @Query()
    @Allow(Permission.Public)
    async bdStoreSettings(@Ctx() ctx: RequestContext) {
        const settings = toPublicStoreSettings(await this.service.get(ctx));
        return {
            ...settings,
            profile: {
                ...settings.profile,
                logo: await this.service.findAsset(ctx, settings.profile.logoAssetId),
                favicon: await this.service.findAsset(ctx, settings.profile.faviconAssetId),
            },
        };
    }
}

import { META_GRAPH_VERSION } from '@ecommbd/shared';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ActiveOrderService, Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { MetaService } from './meta.service';
import { MetaSettingsService } from './meta-settings.service';

@Resolver()
export class MetaShopResolver {
    constructor(
        private settings: MetaSettingsService,
        private meta: MetaService,
        private activeOrders: ActiveOrderService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async bdMetaConfig(@Ctx() ctx: RequestContext) {
        const settings = await this.settings.get(ctx);
        return {
            pixelIds: settings.enabled ? settings.pixelIds : [],
            browserPixel: settings.enabled && settings.browserPixel,
            purchaseTrigger: settings.purchaseTrigger,
            purchaseValue: settings.purchaseValue,
        };
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    async setBdMetaBrowser(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { fbp?: string | null; fbc?: string | null; userAgent?: string | null } },
    ) {
        const order = await this.activeOrders.getActiveOrder(ctx, undefined);
        if (!order) return false;
        await this.meta.saveCheckoutContext(ctx, order, args.input);
        return true;
    }
}

@Resolver()
export class MetaAdminResolver {
    constructor(
        private settings: MetaSettingsService,
        private meta: MetaService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    async bdMetaSetup(@Ctx() ctx: RequestContext) {
        const settings = await this.settings.get(ctx);
        const pixels = [];
        for (const pixelId of settings.pixelIds)
            pixels.push({ pixelId, tokenSaved: !!(await this.settings.token(ctx, pixelId)) });
        return {
            settings,
            pixels,
            tokenProblem: (await this.settings.status(ctx)).tokenProblem,
            keyringConfigured: this.settings.keyringConfigured,
            graphVersion: META_GRAPH_VERSION,
        };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async updateBdMetaSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        const saved = await this.settings.update(ctx, args.input);
        return { settings: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    saveBdMetaToken(@Ctx() ctx: RequestContext, @Args() args: { pixelId: string; token: string }) {
        return this.settings.saveToken(ctx, args.pixelId, args.token);
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    sendBdMetaTestEvent(@Ctx() ctx: RequestContext, @Args() args: { pixelId: string }) {
        return this.meta.sendTest(ctx, args.pixelId);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdMetaEvents(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            eventName?: string | null;
            status?: string | null;
            skip?: number | null;
            take?: number | null;
        },
    ) {
        return this.meta.events(ctx, args);
    }
}

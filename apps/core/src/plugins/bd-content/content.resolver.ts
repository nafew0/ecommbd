import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Permission, RequestContext, Transaction } from '@vendure/core';
import { manageContentPermission } from './constants';
import type { SlugEntityType } from './entities';
import { MenuService } from './menu.service';
import { PageService } from './page.service';
import { SlugHistoryService } from './slug.service';

const SLUG_TYPES: SlugEntityType[] = ['product', 'collection', 'page'];

@Resolver()
export class ContentShopResolver {
    constructor(
        private pages: PageService,
        private menus: MenuService,
        private slugs: SlugHistoryService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    bdPage(@Ctx() ctx: RequestContext, @Args() args: { slug: string }) {
        return this.pages.findBySlug(ctx, args.slug);
    }

    @Query()
    @Allow(Permission.Public)
    bdPages(@Ctx() ctx: RequestContext) {
        return this.pages.listEnabled(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    bdMenus(@Ctx() ctx: RequestContext) {
        return this.menus.resolve(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    bdSlugLookup(@Ctx() ctx: RequestContext, @Args() args: { type: string; slug: string }) {
        if (!SLUG_TYPES.includes(args.type as SlugEntityType)) return null;
        return this.slugs.lookup(args.type as SlugEntityType, args.slug.normalize('NFD'), ctx.languageCode);
    }
}

@Resolver()
export class ContentAdminResolver {
    constructor(
        private pages: PageService,
        private menus: MenuService,
    ) {}

    @Query()
    @Allow(manageContentPermission.Permission)
    bdPages(@Ctx() ctx: RequestContext, @Args() args: { skip?: number; take?: number }) {
        return this.pages.list(ctx, args);
    }

    @Query()
    @Allow(manageContentPermission.Permission)
    bdPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pages.findOne(ctx, args.id);
    }

    @Query()
    @Allow(manageContentPermission.Permission)
    bdMenus(@Ctx() ctx: RequestContext) {
        return this.menus.getForAdmin(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(manageContentPermission.Permission)
    saveBdPage(@Ctx() ctx: RequestContext, @Args() args: { id?: ID; input: unknown }) {
        return this.pages.save(ctx, args.id ?? undefined, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(manageContentPermission.Permission)
    deleteBdPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.pages.delete(ctx, args.id);
    }

    @Mutation()
    @Allow(manageContentPermission.Permission)
    updateBdMenus(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.menus.update(ctx, args.input);
    }
}

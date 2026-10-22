import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, Permission, RequestContext } from '@vendure/core';
import { manageContentPermission } from '../bd-content/constants';
import { editStorefrontPermission } from './constants';
import { type EditableLayoutType, LayoutService } from './layout.service';
import { ThemeService } from './theme.service';

const EDITABLE: EditableLayoutType[] = ['home', 'product', 'page', 'landing'];

@Resolver()
export class SectionsShopResolver {
    constructor(
        private layouts: LayoutService,
        private theme: ThemeService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    bdLayout(@Ctx() ctx: RequestContext, @Args() args: { type: string; pageId?: ID | null }) {
        return this.layouts.published(ctx, args.type, args.pageId);
    }

    @Query()
    @Allow(Permission.Public)
    bdLayoutPreview(@Ctx() ctx: RequestContext, @Args() args: { token: string }) {
        return this.layouts.preview(ctx, args.token);
    }

    @Query()
    @Allow(Permission.Public)
    bdTheme(@Ctx() ctx: RequestContext) {
        return this.theme.get(ctx);
    }
}

@Resolver()
export class SectionsAdminResolver {
    constructor(
        private layouts: LayoutService,
        private theme: ThemeService,
    ) {}

    @Query()
    @Allow(editStorefrontPermission.Permission)
    async bdPageLayout(@Ctx() ctx: RequestContext, @Args() args: { type: string; pageId?: ID | null }) {
        if (!EDITABLE.includes(args.type as EditableLayoutType)) return null;
        const layout = await this.layouts.getOrCreate(ctx, args.type as EditableLayoutType, args.pageId);
        return layout ? this.layouts.adminView(ctx, layout) : null;
    }

    @Query()
    @Allow(editStorefrontPermission.Permission)
    bdLayoutVersions(@Ctx() ctx: RequestContext, @Args() args: { layoutId: ID }) {
        return this.layouts.versions(ctx, args.layoutId);
    }

    @Query()
    @Allow(editStorefrontPermission.Permission)
    bdSavedSections(@Ctx() ctx: RequestContext) {
        return this.layouts.savedSections(ctx);
    }

    @Query()
    @Allow(editStorefrontPermission.Permission)
    bdThemeSettings(@Ctx() ctx: RequestContext) {
        return this.theme.get(ctx);
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    saveBdLayoutDraft(
        @Ctx() ctx: RequestContext,
        @Args() args: { layoutId: ID; document: unknown; baseRevision: number; force?: boolean | null },
    ) {
        return this.layouts.saveDraft(
            ctx,
            args.layoutId,
            args.document,
            args.baseRevision,
            args.force ?? false,
        );
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    publishBdLayout(
        @Ctx() ctx: RequestContext,
        @Args() args: { layoutId: ID; baseVersion: number; force?: boolean | null },
    ) {
        return this.layouts.publish(ctx, args.layoutId, args.baseVersion, args.force ?? false);
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    restoreBdLayoutVersion(@Ctx() ctx: RequestContext, @Args() args: { layoutId: ID; version: number }) {
        return this.layouts.restore(ctx, args.layoutId, args.version);
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    discardBdLayoutDraft(@Ctx() ctx: RequestContext, @Args() args: { layoutId: ID }) {
        return this.layouts.discard(ctx, args.layoutId);
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    async createBdPreviewLink(
        @Ctx() ctx: RequestContext,
        @Args() args: { layoutId: ID; language: string; share?: boolean | null },
    ) {
        const link = await this.layouts.previewLink(ctx, args.layoutId, args.language, args.share ?? false);
        if (!link) throw new Error('Layout not found');
        return link;
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    async saveBdSection(@Ctx() ctx: RequestContext, @Args() args: { name: string; section: unknown }) {
        const saved = await this.layouts.saveSection(ctx, args.name, args.section);
        if (!saved) throw new Error('Not a section, or no name');
        return saved;
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    deleteBdSavedSection(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.layouts.deleteSavedSection(ctx, args.id);
    }

    // Makes a page, so it needs the pages permission (phase 12).
    @Mutation()
    @Allow(manageContentPermission.Permission)
    duplicateBdPage(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.layouts.duplicatePage(ctx, args.id);
    }

    @Mutation()
    @Allow(editStorefrontPermission.Permission)
    updateBdThemeSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.theme.update(ctx, args.input);
    }
}

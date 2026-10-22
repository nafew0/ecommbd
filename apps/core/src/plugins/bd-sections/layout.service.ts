import { encodeSlug, type MenuLink, sanitizeRichText } from '@ecommbd/shared';
import {
    defaultHomeLayout,
    defaultProductTemplate,
    documentIssues,
    documentRefs,
    eachField,
    type LayoutDocument,
    type LayoutIssue,
    LAYOUT_LIMITS,
    type LinkValue,
    mapDocumentIds,
    mapLinks,
    readDocument,
    readSection,
    type SectionData,
} from '@ecommbd/sections';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    AdministratorService,
    Asset,
    Collection,
    ConfigService,
    type ID,
    Product,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull, LessThanOrEqual } from 'typeorm';
import { StoreSettingsService } from '../bd-core';
import { BdPage, BdPageTranslation } from '../bd-content/entities';
import { MenuService } from '../bd-content/menu.service';
import { PageService } from '../bd-content/page.service';
import {
    BD_SECTIONS_PLUGIN_OPTIONS,
    type BdSectionsPluginOptions,
    HISTORY_LIMIT,
    MAX_DOCUMENT_BYTES,
    MAX_SAVED_SECTIONS,
    PREVIEW_MINUTES,
} from './constants';
import { BdPageLayout, BdPageLayoutVersion, BdSavedSection } from './entities';
import { createPreviewToken, verifyPreviewToken } from './preview-token';
import { StorefrontPurger } from './storefront-purger';

export type EditableLayoutType = 'home' | 'product' | 'page' | 'landing';

/**
 * Another plugin's pages with layouts (phase 16: sales pages, `landing:<id>`). That plugin makes
 * each layout when it makes the page, and says what the editor calls it and where it's previewed.
 */
export interface LayoutOwner {
    title(ctx: RequestContext, ownerId: ID): Promise<string>;
    /** The storefront path, e.g. `/s/chia-seeds/`. */
    path(ctx: RequestContext, ownerId: ID): Promise<string>;
}

const OWNERS = new Map<string, LayoutOwner>();

export function registerLayoutOwner(type: 'landing', owner: LayoutOwner): void {
    OWNERS.set(type, owner);
}

/** `landing:12` → `12`. */
const ownerIdOf = (layout: BdPageLayout) => layout.key.slice(layout.key.indexOf(':') + 1);

export interface LayoutWarning {
    sectionId: string;
    blockId?: string;
    field: string;
    code: string;
}

export interface AdminLayoutView {
    id: ID;
    type: string;
    pageId: ID | null;
    title: string;
    draft: LayoutDocument;
    draftRevision: number;
    draftSavedAt: Date | null;
    draftSavedBy: string;
    publishedVersion: number;
    publishedAt: Date | null;
    publishedBy: string;
    hasChanges: boolean;
    warnings: LayoutWarning[];
}

export interface LayoutResult {
    layout: AdminLayoutView | null;
    errors: LayoutWarning[];
    conflict: { by: string; at: Date | null; publishedVersion: number; draftRevision: number } | null;
}

export interface ShopLayoutView {
    id: ID;
    type: string;
    pageId: ID | null;
    version: number;
    document: LayoutDocument;
    assets: Asset[];
}

const issueWarning = (issue: LayoutIssue): LayoutWarning => ({ ...issue });

/**
 * Page layouts (roadmap phase 15): drafts autosaved by the editor, publishing with a version stamp,
 * the last 20 versions, preview links, and the published sections for the storefront.
 */
@Injectable()
export class LayoutService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private administrators: AdministratorService,
        private moduleRef: ModuleRef,
        private purger: StorefrontPurger,
        @Inject(BD_SECTIONS_PLUGIN_OPTIONS) private options: BdSectionsPluginOptions,
    ) {}

    // Services of our other plugins, found like Vendure's own injector does (any module).
    private get storeSettings() {
        return this.moduleRef.get(StoreSettingsService, { strict: false });
    }
    private get menus() {
        return this.moduleRef.get(MenuService, { strict: false });
    }
    private get pages() {
        return this.moduleRef.get(PageService, { strict: false });
    }

    // IDs in JSON aren't encoded and decoded by Vendure like typed ID arguments are.
    private encode = (id: string) =>
        String(this.configService.entityOptions.entityIdStrategy?.encodeId(id) ?? id);
    private decode = (id: string) =>
        String(this.configService.entityOptions.entityIdStrategy?.decodeId(id) ?? id);

    private async staffName(ctx: RequestContext): Promise<string> {
        if (!ctx.activeUserId) return '';
        const administrator = await this.administrators.findOneByUserId(ctx, ctx.activeUserId);
        return administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : '';
    }

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, BdPageLayout);
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.repo(ctx).findOne({ where: { id } });
    }

    /** The layout of the home page, the product page template or a page, made on first use. */
    async getOrCreate(
        ctx: RequestContext,
        type: EditableLayoutType,
        pageId?: ID | null,
    ): Promise<BdPageLayout | null> {
        if ((type === 'page' || type === 'landing') && !pageId) return null;
        const key = type === 'page' || type === 'landing' ? `${type}:${pageId}` : type;
        const existing = await this.repo(ctx).findOne({ where: { key } });
        // Sales pages make their own layout (from a template) when they're made.
        if (existing || type === 'landing') return existing;
        let draft: LayoutDocument;
        if (type === 'page') {
            if (!(await this.connection.getRepository(ctx, BdPage).findOne({ where: { id: pageId! } })))
                return null;
            draft = { sections: [] };
        } else if (type === 'home') {
            const { profile } = await this.storeSettings.get(ctx);
            draft = defaultHomeLayout({ name: profile.storeName, description: profile.shortDescription });
        } else {
            draft = defaultProductTemplate();
        }
        // Two tabs opening the editor at once: the unique key keeps one row.
        await this.repo(ctx)
            .createQueryBuilder()
            .insert()
            .into(BdPageLayout)
            .values({ type, key, pageId: type === 'page' ? pageId : null, draft })
            .orIgnore()
            .execute();
        return this.repo(ctx).findOne({ where: { key } });
    }

    /** The layout as the editor sees it: IDs encoded, with warnings and the page's title. */
    async adminView(ctx: RequestContext, layout: BdPageLayout): Promise<AdminLayoutView> {
        let title = '';
        const owner = OWNERS.get(layout.type);
        if (owner) title = await owner.title(ctx, ownerIdOf(layout));
        if (layout.pageId) {
            const translations = await this.connection
                .getRepository(ctx, BdPageTranslation)
                .find({ where: { pageId: layout.pageId } });
            const pick = (language: string) =>
                translations.find(item => item.languageCode === language)?.title;
            title = pick(ctx.languageCode) ?? translations[0]?.title ?? '';
        }
        return {
            id: layout.id,
            type: layout.type,
            pageId: layout.pageId,
            title,
            draft: mapDocumentIds(readDocument(layout.draft), (_kind, id) => this.encode(id)),
            draftRevision: layout.draftRevision,
            draftSavedAt: layout.draftSavedAt,
            draftSavedBy: layout.draftSavedBy,
            publishedVersion: layout.publishedVersion,
            publishedAt: layout.publishedAt,
            publishedBy: layout.publishedBy,
            hasChanges: JSON.stringify(layout.draft) !== JSON.stringify(layout.published ?? { sections: [] }),
            warnings: await this.warnings(ctx, layout.draft),
        };
    }

    /**
     * What the editor should point out on each section: products, categories, pages and images
     * that are gone or hidden (the storefront shows nothing, or a placeholder, in their place), a
     * product grid or featured product with nothing picked, and a page long enough to get slow.
     */
    async warnings(ctx: RequestContext, document: LayoutDocument): Promise<LayoutWarning[]> {
        const refs = documentRefs(document, { includeHidden: true });
        const found = async <T extends { id: ID }>(ids: string[], load: (ids: string[]) => Promise<T[]>) =>
            new Set(ids.length ? (await load(ids)).map(item => String(item.id)) : []);
        const [products, collections, pages, assets] = await Promise.all([
            found(refs.products, ids =>
                this.connection.getRepository(ctx, Product).find({
                    where: { id: In(ids), enabled: true, deletedAt: IsNull() },
                    select: ['id'],
                }),
            ),
            found(refs.collections, ids =>
                this.connection
                    .getRepository(ctx, Collection)
                    .find({ where: { id: In(ids), isPrivate: false }, select: ['id'] }),
            ),
            found(refs.pages, ids =>
                this.connection.getRepository(ctx, BdPage).find({ where: { id: In(ids), enabled: true } }),
            ),
            found(refs.assets, ids =>
                this.connection.getRepository(ctx, Asset).find({ where: { id: In(ids) }, select: ['id'] }),
            ),
        ]);
        const warnings: LayoutWarning[] = [];
        const add = (section: SectionData, field: string, code: string, blockId?: string) => {
            if (
                !warnings.some(
                    w =>
                        w.sectionId === section.uid &&
                        w.field === field &&
                        w.blockId === blockId &&
                        w.code === code,
                )
            ) {
                warnings.push({ sectionId: section.uid, blockId, field, code });
            }
        };
        mapDocumentIds(document, (kind, id, section) => {
            const missing =
                (kind === 'product' && !products.has(id)) ||
                (kind === 'collection' && !collections.has(id)) ||
                (kind === 'page' && !pages.has(id)) ||
                (kind === 'asset' && !assets.has(id));
            if (missing) add(section, '', `${kind === 'asset' ? 'image' : kind}Missing`);
            return id;
        });
        for (const visit of eachField(document)) {
            if (!visit.shown) continue;
            if (
                visit.section.type === 'product-grid' &&
                visit.name === 'products' &&
                !(visit.value as string[]).length
            ) {
                add(visit.section, 'products', 'noProducts');
            }
            if (visit.section.type === 'featured-product' && visit.name === 'product' && !visit.value) {
                add(visit.section, 'product', 'noProduct');
            }
        }
        if (document.sections.length > LAYOUT_LIMITS.warnAbove) {
            add(document.sections[LAYOUT_LIMITS.warnAbove]!, 'sections', 'manySections');
        }
        return warnings;
    }

    private conflictOf(layout: BdPageLayout, kind: 'draft' | 'publish'): LayoutResult['conflict'] {
        return {
            by: kind === 'draft' ? layout.draftSavedBy : layout.publishedBy,
            at: kind === 'draft' ? layout.draftSavedAt : layout.publishedAt,
            publishedVersion: layout.publishedVersion,
            draftRevision: layout.draftRevision,
        };
    }

    /** The editor's input, ready to store: read for this release, sanitized, IDs decoded. */
    private prepare(input: unknown): { document: LayoutDocument; errors: LayoutWarning[] } {
        const document = mapDocumentIds(readDocument(input, { sanitize: sanitizeRichText }), (_kind, id) =>
            this.decode(id),
        );
        const errors: LayoutWarning[] = [];
        if (document.sections.length > LAYOUT_LIMITS.sections) {
            errors.push({ sectionId: '', field: 'sections', code: 'tooManySections' });
        }
        if (Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) {
            errors.push({ sectionId: '', field: 'sections', code: 'tooLarge' });
        }
        return { document, errors };
    }

    /** Autosave: refused as a conflict when someone else saved since `baseRevision`, unless forced. */
    async saveDraft(
        ctx: RequestContext,
        id: ID,
        input: unknown,
        baseRevision: number,
        force = false,
    ): Promise<LayoutResult> {
        const layout = await this.findOne(ctx, id);
        if (!layout)
            return {
                layout: null,
                errors: [{ sectionId: '', field: 'id', code: 'notFound' }],
                conflict: null,
            };
        const { document, errors } = this.prepare(input);
        if (errors.length) return { layout: null, errors, conflict: null };
        const query = this.repo(ctx)
            .createQueryBuilder()
            .update(BdPageLayout)
            .set({
                draft: document,
                draftRevision: () => '"draftRevision" + 1',
                draftSavedAt: new Date(),
                draftSavedBy: await this.staffName(ctx),
            })
            .where('id = :id', { id: layout.id });
        if (!force) query.andWhere('"draftRevision" = :baseRevision', { baseRevision });
        const { affected } = await query.execute();
        const saved = (await this.findOne(ctx, id))!;
        if (!affected) return { layout: null, errors: [], conflict: this.conflictOf(saved, 'draft') };
        return { layout: await this.adminView(ctx, saved), errors: [], conflict: null };
    }

    /**
     * Makes the draft live: refused with the problems that stop it (broken links, too many
     * sections), or as a conflict when someone published since `baseVersion`, unless forced.
     * Keeps the last 20 versions and purges the storefront's cache.
     */
    async publish(ctx: RequestContext, id: ID, baseVersion: number, force = false): Promise<LayoutResult> {
        const by = await this.staffName(ctx);
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const repo = this.connection.getRepository(txCtx, BdPageLayout);
            const layout = await repo
                .createQueryBuilder('layout')
                .setLock('pessimistic_write')
                .where('layout.id = :id', { id })
                .getOne();
            if (!layout) {
                return {
                    layout: null,
                    errors: [{ sectionId: '', field: 'id', code: 'notFound' }],
                    conflict: null,
                };
            }
            const document = readDocument(layout.draft);
            const errors = documentIssues(document).map(issueWarning);
            if (errors.length) return { layout: null, errors, conflict: null };
            if (!force && layout.publishedVersion !== baseVersion) {
                return { layout: null, errors: [], conflict: this.conflictOf(layout, 'publish') };
            }
            const version = layout.publishedVersion + 1;
            const now = new Date();
            await repo.update(layout.id, {
                published: document,
                draft: document,
                publishedVersion: version,
                publishedAt: now,
                publishedBy: by,
            });
            const versions = this.connection.getRepository(txCtx, BdPageLayoutVersion);
            await versions.save(
                new BdPageLayoutVersion({
                    layoutId: layout.id,
                    version,
                    document,
                    publishedAt: now,
                    publishedBy: by,
                }),
            );
            await versions.delete({ layoutId: layout.id, version: LessThanOrEqual(version - HISTORY_LIMIT) });
            return null;
        });
        if (result) return result;
        await this.purger.purge(['layouts']);
        return {
            layout: await this.adminView(ctx, (await this.findOne(ctx, id))!),
            errors: [],
            conflict: null,
        };
    }

    private async replaceDraft(ctx: RequestContext, layout: BdPageLayout, document: LayoutDocument) {
        await this.repo(ctx).update(layout.id, {
            draft: readDocument(document),
            draftRevision: layout.draftRevision + 1,
            draftSavedAt: new Date(),
            draftSavedBy: await this.staffName(ctx),
        });
        return {
            layout: await this.adminView(ctx, (await this.findOne(ctx, layout.id))!),
            errors: [],
            conflict: null,
        };
    }

    /** Puts a published version back into the draft. */
    async restore(ctx: RequestContext, id: ID, version: number): Promise<LayoutResult> {
        const layout = await this.findOne(ctx, id);
        const stored = layout
            ? await this.connection
                  .getRepository(ctx, BdPageLayoutVersion)
                  .findOne({ where: { layoutId: layout.id, version } })
            : null;
        if (!layout || !stored) {
            return {
                layout: null,
                errors: [{ sectionId: '', field: 'version', code: 'notFound' }],
                conflict: null,
            };
        }
        return this.replaceDraft(ctx, layout, stored.document);
    }

    /** Throws the draft away: back to what's live. */
    async discard(ctx: RequestContext, id: ID): Promise<LayoutResult> {
        const layout = await this.findOne(ctx, id);
        if (!layout)
            return {
                layout: null,
                errors: [{ sectionId: '', field: 'id', code: 'notFound' }],
                conflict: null,
            };
        return this.replaceDraft(ctx, layout, layout.published ?? { sections: [] });
    }

    async versions(ctx: RequestContext, id: ID) {
        const rows = await this.connection.getRepository(ctx, BdPageLayoutVersion).find({
            where: { layoutId: id },
            order: { version: 'DESC' },
            take: HISTORY_LIMIT,
        });
        return rows.map(row => ({
            version: row.version,
            publishedAt: row.publishedAt,
            publishedBy: row.publishedBy,
            sectionCount: readDocument(row.document).sections.length,
        }));
    }

    /** A storefront link that shows this layout's draft: the editor's frame, or a link to share. */
    async previewLink(ctx: RequestContext, id: ID, language: string, share = false) {
        const layout = await this.findOne(ctx, id);
        if (!layout) return null;
        const mode = share ? 'share' : 'editor';
        const expires = Math.floor(Date.now() / 1000) + PREVIEW_MINUTES[mode] * 60;
        const token = createPreviewToken(
            { layoutId: String(layout.id), channel: ctx.channel.token, mode, expires },
            this.options.secret,
        );
        const lang = language === 'en' ? 'en' : 'bn';
        const { locale } = await this.storeSettings.get(ctx);
        const prefix = lang === locale.defaultLanguage ? '' : `/${lang}`;
        const base = (this.options.storefrontUrl ?? '').replace(/\/$/, '');
        const path = await this.previewPath(ctx, layout, lang);
        return {
            url: `${base}${prefix}${path}?preview=${token}`,
            token,
            expiresAt: new Date(expires * 1000),
        };
    }

    private async previewPath(ctx: RequestContext, layout: BdPageLayout, language: string): Promise<string> {
        const owner = OWNERS.get(layout.type);
        if (owner) return owner.path(ctx, ownerIdOf(layout));
        if (layout.type === 'page' && layout.pageId) {
            const translations = await this.connection
                .getRepository(ctx, BdPageTranslation)
                .find({ where: { pageId: layout.pageId } });
            const translation = translations.find(item => item.languageCode === language) ?? translations[0];
            return translation ? `/${encodeSlug(translation.slug)}/` : '/';
        }
        if (layout.type === 'product') {
            // Any product shows the template; the newest is the likeliest to have photos.
            const product = await this.connection.getRepository(ctx, Product).findOne({
                where: { enabled: true, deletedAt: IsNull() },
                order: { createdAt: 'DESC' },
                relations: ['translations'],
            });
            const translation =
                product?.translations.find(item => item.languageCode === language) ??
                product?.translations[0];
            return translation ? `/product/${encodeSlug(translation.slug)}/` : '/';
        }
        return '/';
    }

    /** The published layout for the storefront; null before the first publish. */
    async published(ctx: RequestContext, type: string, pageId?: ID | null): Promise<ShopLayoutView | null> {
        const key =
            type === 'page' || type === 'landing'
                ? pageId
                    ? `${type}:${pageId}`
                    : null
                : type === 'home' || type === 'product'
                  ? type
                  : null;
        if (!key) return null;
        const layout = await this.repo(ctx).findOne({ where: { key } });
        if (!layout?.published) return null;
        return this.shopView(ctx, layout, layout.published, layout.publishedVersion);
    }

    /** A draft for a valid preview token. */
    async preview(ctx: RequestContext, token: string) {
        const claims = verifyPreviewToken(token, this.options.secret, ctx.channel.token);
        if (!claims) return null;
        const layout = await this.findOne(ctx, claims.layoutId);
        if (!layout) return null;
        return {
            layout: await this.shopView(ctx, layout, layout.draft, layout.draftRevision),
            mode: claims.mode,
            expiresAt: new Date(claims.expires * 1000),
        };
    }

    /** Sections for the storefront: links resolved to paths in the request's language, IDs encoded, images listed. */
    private async shopView(
        ctx: RequestContext,
        layout: BdPageLayout,
        stored: LayoutDocument,
        version: number,
    ): Promise<ShopLayoutView> {
        const document = readDocument(stored, { sanitize: sanitizeRichText });
        const hrefs = new Map<string, string | undefined>();
        for (const visit of eachField(document)) {
            if (visit.field.kind !== 'link') continue;
            const link = visit.value as LinkValue;
            const key = JSON.stringify(link);
            if (!hrefs.has(key)) hrefs.set(key, await this.href(ctx, link));
        }
        const linked = mapLinks(document, link => {
            const href = hrefs.get(JSON.stringify(link));
            return href ? { ...link, href } : link;
        });
        const { assets: assetIds } = documentRefs(linked);
        const assets = assetIds.length
            ? await this.connection.getRepository(ctx, Asset).find({ where: { id: In(assetIds) } })
            : [];
        return {
            id: layout.id,
            type: layout.type,
            pageId: layout.pageId,
            version,
            document: mapDocumentIds(linked, (_kind, id) => this.encode(id)),
            assets,
        };
    }

    /** Where a link goes; undefined for none, or for WhatsApp and calls (the storefront knows the numbers). */
    private async href(ctx: RequestContext, link: LinkValue): Promise<string | undefined> {
        switch (link.type) {
            case 'home':
                return '/';
            case 'search':
                return '/search/';
            case 'anchor':
                return link.anchor ? `#${link.anchor}` : undefined;
            case 'category':
            case 'product':
            case 'page':
            case 'policy':
            case 'url':
                return (await this.menus.linkUrl(ctx, link as MenuLink)) ?? undefined;
            default:
                return undefined;
        }
    }

    /** Makes another plugin's layout with its first draft (a sales page from a template), IDs as stored. */
    async createOwned(ctx: RequestContext, type: 'landing', ownerId: ID, draft: LayoutDocument) {
        const document = readDocument(draft, { sanitize: sanitizeRichText });
        return this.repo(ctx).save(
            new BdPageLayout({ type, key: `${type}:${ownerId}`, pageId: null, draft: document }),
        );
    }

    /** The draft of another plugin's layout, for copying (IDs as stored). */
    async ownedDraft(ctx: RequestContext, type: 'landing', ownerId: ID): Promise<LayoutDocument | null> {
        return (await this.repo(ctx).findOne({ where: { key: `${type}:${ownerId}` } }))?.draft ?? null;
    }

    async deleteOwned(ctx: RequestContext, type: 'landing', ownerId: ID) {
        await this.repo(ctx).delete({ key: `${type}:${ownerId}` });
        await this.purger.purge(['layouts']);
    }

    /** A copy of a page, switched off, with its sections as a draft. */
    async duplicatePage(ctx: RequestContext, pageId: ID): Promise<BdPage | null> {
        const page = await this.connection.getRepository(ctx, BdPage).findOne({ where: { id: pageId } });
        if (!page) return null;
        const suffix = { bn: ' (কপি)', en: ' (copy)' } as const;
        for (let attempt = 1; attempt <= 20; attempt++) {
            const ending = attempt === 1 ? '-copy' : `-copy-${attempt}`;
            const translation = (language: 'bn' | 'en') => {
                const source = page.translations.find(item => item.languageCode === language);
                return source
                    ? {
                          title: `${source.title}${suffix[language]}`.slice(0, 150),
                          slug: `${source.slug.normalize('NFC')}${ending}`,
                          body: source.body,
                          seoTitle: source.seoTitle,
                          seoDescription: source.seoDescription,
                      }
                    : { title: '', slug: '', body: '', seoTitle: '', seoDescription: '' };
            };
            const saved = await this.pages.save(ctx, undefined, {
                enabled: false,
                translations: { bn: translation('bn'), en: translation('en') },
            });
            if (saved.errors.some(error => error.code === 'taken')) continue;
            if (!saved.page) return null;
            const source = await this.repo(ctx).findOne({ where: { key: `page:${page.id}` } });
            if (source) {
                await this.repo(ctx).save(
                    new BdPageLayout({
                        type: 'page',
                        key: `page:${saved.page.id}`,
                        pageId: saved.page.id,
                        draft: source.draft,
                    }),
                );
            }
            return saved.page;
        }
        return null;
    }

    savedSections(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, BdSavedSection)
            .find({ order: { createdAt: 'DESC' }, take: MAX_SAVED_SECTIONS })
            .then(rows =>
                rows.map(row => ({
                    ...row,
                    section: mapDocumentIds({ sections: [row.section] }, (_kind, id) => this.encode(id))
                        .sections[0],
                })),
            );
    }

    /** Saves a styled section for reuse; null when it isn't a section this release knows. */
    async saveSection(ctx: RequestContext, name: string, input: unknown) {
        const section = readSection(input, { sanitize: sanitizeRichText });
        const label = name.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!section || !label) return null;
        const repo = this.connection.getRepository(ctx, BdSavedSection);
        const decoded = mapDocumentIds({ sections: [section] }, (_kind, id) => this.decode(id)).sections[0]!;
        const saved = await repo.save(
            new BdSavedSection({ name: label, section: decoded, createdBy: await this.staffName(ctx) }),
        );
        // The oldest go once there are too many.
        const extra = await repo.find({
            order: { createdAt: 'DESC' },
            skip: MAX_SAVED_SECTIONS,
            select: ['id'],
        });
        if (extra.length) await repo.delete({ id: In(extra.map(row => row.id)) });
        return { ...saved, section };
    }

    async deleteSavedSection(ctx: RequestContext, id: ID): Promise<boolean> {
        const { affected } = await this.connection.getRepository(ctx, BdSavedSection).delete(id);
        return !!affected;
    }
}

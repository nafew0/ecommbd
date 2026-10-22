import {
    defaultMenus,
    encodeSlug,
    type MenuItem,
    type MenuLink,
    type Menus,
    parseMenus,
    POLICY_SLUGS,
    type SettingsFieldError,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Collection,
    CollectionService,
    ConfigService,
    ProductService,
    RequestContext,
    SettingsStoreService,
    TransactionalConnection,
} from '@vendure/core';
import { MENUS_KEY } from './constants';
import { BdPage } from './entities';

export interface ResolvedMenuLink {
    label: string;
    /** A path on the store without the language prefix (`/product-category/saree/`), or a full URL. */
    url: string;
    children: ResolvedMenuLink[];
}

export type UpdateMenusResult = { menus: Menus; errors: [] } | { menus: null; errors: SettingsFieldError[] };

/** The storefront path of a category: its parents' slugs, then its own. */
export async function collectionPath(
    ctx: RequestContext,
    collectionService: CollectionService,
    collection: Collection,
): Promise<string> {
    const crumbs = await collectionService.getBreadcrumbs(ctx, collection);
    // Breadcrumbs start with Vendure's hidden root collection.
    const slugs = crumbs
        .filter(crumb => crumb.slug && crumb.slug !== '__root_collection__')
        .map(crumb => encodeSlug(crumb.slug));
    return `/product-category/${slugs.join('/')}/`;
}

function mapLinkIds(menus: Menus, map: (id: string) => string): Menus {
    const link = (value: MenuLink): MenuLink => ('id' in value ? { ...value, id: map(value.id) } : value);
    const item = (value: MenuItem): MenuItem => ({
        ...value,
        link: link(value.link),
        children: value.children.map(child => ({ ...child, link: link(child.link) })),
    });
    return { header: menus.header.map(item), footer: menus.footer.map(item) };
}

/** Header and footer menus in the settings store, resolved to paths in the request's language. */
@Injectable()
export class MenuService {
    constructor(
        private settingsStore: SettingsStoreService,
        private connection: TransactionalConnection,
        private collectionService: CollectionService,
        private productService: ProductService,
        private configService: ConfigService,
    ) {}

    /** As stored: links hold database IDs. */
    async get(ctx: RequestContext): Promise<Menus> {
        return (await this.settingsStore.get<Menus>(ctx, MENUS_KEY)) ?? defaultMenus();
    }

    /** For the Admin API: IDs as the API shows them (an ID strategy may encode them). */
    async getForAdmin(ctx: RequestContext): Promise<Menus> {
        const { entityIdStrategy } = this.configService.entityOptions;
        return mapLinkIds(await this.get(ctx), id => String(entityIdStrategy?.encodeId(id) ?? id));
    }

    async update(ctx: RequestContext, input: unknown): Promise<UpdateMenusResult> {
        const parsed = parseMenus(input);
        if (!parsed.ok) return { menus: null, errors: parsed.errors };
        // JSON input isn't decoded by Vendure like typed ID arguments are.
        const { entityIdStrategy } = this.configService.entityOptions;
        const stored = mapLinkIds(parsed.value, id => String(entityIdStrategy?.decodeId(id) ?? id));
        const saved = await this.settingsStore.set(ctx, MENUS_KEY, stored);
        if (!saved.result) throw new Error(`Could not save menus: ${saved.error}`);
        return { menus: parsed.value, errors: [] };
    }

    async resolve(ctx: RequestContext): Promise<{ header: ResolvedMenuLink[]; footer: ResolvedMenuLink[] }> {
        const menus = await this.get(ctx);
        return {
            header: await this.resolveItems(ctx, menus.header),
            footer: await this.resolveItems(ctx, menus.footer),
        };
    }

    private async resolveItems(
        ctx: RequestContext,
        items: Array<Pick<MenuItem, 'label' | 'link'> & { children?: MenuItem['children'] }>,
    ): Promise<ResolvedMenuLink[]> {
        const language = ctx.languageCode === 'en' ? 'en' : 'bn';
        const other = language === 'en' ? 'bn' : 'en';
        const resolved: ResolvedMenuLink[] = [];
        for (const item of items) {
            const url = await this.linkUrl(ctx, item.link);
            // A link to something deleted since is left out rather than shown broken.
            if (!url) continue;
            resolved.push({
                label: item.label[language] || item.label[other],
                url,
                children: await this.resolveItems(ctx, item.children ?? []),
            });
        }
        return resolved;
    }

    /** A link's path in the request's language (or its URL); null when its target is gone or hidden. */
    async linkUrl(ctx: RequestContext, link: MenuLink): Promise<string | null> {
        switch (link.type) {
            case 'url':
                return link.url;
            case 'policy':
                return `/${POLICY_SLUGS[link.policy]}/`;
            case 'page': {
                const page = await this.connection.getRepository(ctx, BdPage).findOne({
                    where: { id: link.id, enabled: true },
                });
                const translation =
                    page?.translations.find(candidate => candidate.languageCode === ctx.languageCode) ??
                    page?.translations[0];
                return translation ? `/${encodeSlug(translation.slug)}/` : null;
            }
            case 'category': {
                const collection = await this.collectionService.findOne(ctx, link.id);
                return collection && !collection.isPrivate
                    ? collectionPath(ctx, this.collectionService, collection)
                    : null;
            }
            case 'product': {
                const product = await this.productService.findOne(ctx, link.id);
                return product?.enabled ? `/product/${encodeSlug(product.slug)}/` : null;
            }
        }
    }
}

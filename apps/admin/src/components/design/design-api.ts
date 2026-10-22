import type { LayoutDocument, SectionData, ThemeProblem, ThemeSettings } from '@ecommbd/sections';
import { adminApi } from '../../lib/api';

/** Admin API calls for the page editor and the theme screen (roadmap phase 15, bd-sections). */

export type LayoutKind = 'home' | 'product' | 'page';

export interface LayoutWarning {
    sectionId: string;
    blockId: string | null;
    field: string;
    code: string;
}

export interface AdminLayout {
    id: string;
    type: LayoutKind;
    pageId: string | null;
    title: string;
    draft: LayoutDocument;
    draftRevision: number;
    draftSavedAt: string | null;
    draftSavedBy: string;
    publishedVersion: number;
    publishedAt: string | null;
    publishedBy: string;
    hasChanges: boolean;
    warnings: LayoutWarning[];
}

export interface LayoutConflict {
    by: string;
    at: string | null;
    publishedVersion: number;
    draftRevision: number;
}

export interface LayoutResult {
    layout: AdminLayout | null;
    errors: LayoutWarning[];
    conflict: LayoutConflict | null;
}

const LAYOUT = `id type pageId title draft draftRevision draftSavedAt draftSavedBy publishedVersion publishedAt publishedBy hasChanges warnings { sectionId blockId field code }`;
const RESULT = `layout { ${LAYOUT} } errors { sectionId blockId field code } conflict { by at publishedVersion draftRevision }`;

export function fetchLayout(kind: LayoutKind, pageId?: string) {
    return adminApi<{ bdPageLayout: AdminLayout | null }>(
        `query ($type: String!, $pageId: ID) { bdPageLayout(type: $type, pageId: $pageId) { ${LAYOUT} } }`,
        { type: kind, pageId },
    ).then(result => result.bdPageLayout);
}

export function saveDraft(layoutId: string, document: LayoutDocument, baseRevision: number, force = false) {
    return adminApi<{ saveBdLayoutDraft: LayoutResult }>(
        `mutation ($layoutId: ID!, $document: JSON!, $baseRevision: Int!, $force: Boolean) {
            saveBdLayoutDraft(layoutId: $layoutId, document: $document, baseRevision: $baseRevision, force: $force) { ${RESULT} }
        }`,
        { layoutId, document, baseRevision, force },
    ).then(result => result.saveBdLayoutDraft);
}

export function publishLayout(layoutId: string, baseVersion: number, force = false) {
    return adminApi<{ publishBdLayout: LayoutResult }>(
        `mutation ($layoutId: ID!, $baseVersion: Int!, $force: Boolean) {
            publishBdLayout(layoutId: $layoutId, baseVersion: $baseVersion, force: $force) { ${RESULT} }
        }`,
        { layoutId, baseVersion, force },
    ).then(result => result.publishBdLayout);
}

export interface LayoutVersion {
    version: number;
    publishedAt: string;
    publishedBy: string;
    sectionCount: number;
}

export function fetchVersions(layoutId: string) {
    return adminApi<{ bdLayoutVersions: LayoutVersion[] }>(
        `query ($layoutId: ID!) { bdLayoutVersions(layoutId: $layoutId) { version publishedAt publishedBy sectionCount } }`,
        { layoutId },
    ).then(result => result.bdLayoutVersions);
}

export function restoreVersion(layoutId: string, version: number) {
    return adminApi<{ restoreBdLayoutVersion: LayoutResult }>(
        `mutation ($layoutId: ID!, $version: Int!) { restoreBdLayoutVersion(layoutId: $layoutId, version: $version) { ${RESULT} } }`,
        { layoutId, version },
    ).then(result => result.restoreBdLayoutVersion);
}

export function discardDraft(layoutId: string) {
    return adminApi<{ discardBdLayoutDraft: LayoutResult }>(
        `mutation ($layoutId: ID!) { discardBdLayoutDraft(layoutId: $layoutId) { ${RESULT} } }`,
        { layoutId },
    ).then(result => result.discardBdLayoutDraft);
}

export interface PreviewLink {
    url: string;
    token: string;
    expiresAt: string;
}

export function createPreviewLink(layoutId: string, language: 'bn' | 'en', share = false) {
    return adminApi<{ createBdPreviewLink: PreviewLink }>(
        `mutation ($layoutId: ID!, $language: String!, $share: Boolean) {
            createBdPreviewLink(layoutId: $layoutId, language: $language, share: $share) { url token expiresAt }
        }`,
        { layoutId, language, share },
    ).then(result => result.createBdPreviewLink);
}

export interface SavedSection {
    id: string;
    name: string;
    section: SectionData;
    createdAt: string;
    createdBy: string;
}

export function fetchSavedSections() {
    return adminApi<{ bdSavedSections: SavedSection[] }>(
        `{ bdSavedSections { id name section createdAt createdBy } }`,
    ).then(result => result.bdSavedSections);
}

export function saveSection(name: string, section: SectionData) {
    return adminApi<{ saveBdSection: SavedSection }>(
        `mutation ($name: String!, $section: JSON!) { saveBdSection(name: $name, section: $section) { id name section createdAt createdBy } }`,
        { name, section },
    ).then(result => result.saveBdSection);
}

export function deleteSavedSection(id: string) {
    return adminApi<{ deleteBdSavedSection: boolean }>(
        `mutation ($id: ID!) { deleteBdSavedSection(id: $id) }`,
        { id },
    );
}

export function duplicatePage(id: string) {
    return adminApi<{ duplicateBdPage: { id: string } | null }>(
        `mutation ($id: ID!) { duplicateBdPage(id: $id) { id } }`,
        { id },
    ).then(result => result.duplicateBdPage);
}

export interface ProductOption {
    id: string;
    name: string;
    enabled: boolean;
    featuredAsset: { preview: string } | null;
}

const PRODUCT_OPTION = `id name enabled featuredAsset { preview }`;

export function searchProducts(term: string) {
    return adminApi<{ products: { items: ProductOption[] } }>(
        `query ($term: String!) { products(options: { take: 20, filter: { name: { contains: $term } }, sort: { updatedAt: DESC } }) { items { ${PRODUCT_OPTION} } } }`,
        { term },
    ).then(result => result.products.items);
}

export function productsById(ids: string[]) {
    return adminApi<{ products: { items: ProductOption[] } }>(
        `query ($ids: [String!]!, $take: Int!) { products(options: { take: $take, filter: { id: { in: $ids } } }) { items { ${PRODUCT_OPTION} } } }`,
        { ids, take: ids.length },
    ).then(result => result.products.items);
}

export interface CollectionOption {
    id: string;
    name: string;
    isPrivate: boolean;
    /** Names from the top category down, without Vendure's hidden root. */
    path: string[];
}

export function fetchCollections() {
    return adminApi<{
        collections: {
            items: Array<{
                id: string;
                name: string;
                isPrivate: boolean;
                breadcrumbs: Array<{ name: string; slug: string }>;
            }>;
        };
    }>(
        `{ collections(options: { take: 500, sort: { position: ASC } }) { items { id name isPrivate breadcrumbs { name slug } } } }`,
    ).then(result =>
        result.collections.items.map(item => ({
            id: item.id,
            name: item.name,
            isPrivate: item.isPrivate,
            path: item.breadcrumbs
                .filter(crumb => crumb.slug !== '__root_collection__')
                .map(crumb => crumb.name),
        })),
    );
}

export interface PageOption {
    id: string;
    enabled: boolean;
    translations: Array<{ languageCode: 'bn' | 'en'; title: string; slug: string }>;
}

export function fetchPages() {
    return adminApi<{ bdPages: { items: PageOption[] } }>(
        `{ bdPages(take: 100) { items { id enabled translations { languageCode title slug } } } }`,
    ).then(result => result.bdPages.items);
}

export function fetchTheme() {
    return adminApi<{ bdThemeSettings: ThemeSettings }>(`{ bdThemeSettings }`).then(
        result => result.bdThemeSettings,
    );
}

export interface ThemeResult {
    settings: ThemeSettings | null;
    errors: ThemeProblem[];
    warnings: ThemeProblem[];
}

export function updateTheme(input: ThemeSettings) {
    return adminApi<{ updateBdThemeSettings: ThemeResult }>(
        `mutation ($input: JSON!) { updateBdThemeSettings(input: $input) { settings errors { path code ratio } warnings { path code ratio } } }`,
        { input },
    ).then(result => result.updateBdThemeSettings);
}

export function fetchStoreLogo() {
    return adminApi<{
        bdStoreSettings: {
            logo: { preview: string } | null;
            settings: { profile: { storeName: { bn: string; en: string } } };
        };
    }>(`{ bdStoreSettings { logo { preview } settings } }`).then(result => ({
        logo: result.bdStoreSettings.logo,
        storeName: result.bdStoreSettings.settings.profile.storeName,
    }));
}

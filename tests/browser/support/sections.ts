import {
    defaultHomeLayout,
    defaultThemeSettings,
    type LayoutDocument,
    type ThemeSettings,
} from '@ecommbd/sections';
import type { ApiSession } from './store-api';

/** Page layouts and the theme for browser tests (phase 15), set through the Admin API. */

export type LayoutKind = 'home' | 'product' | 'page';

const LAYOUT = `id draftRevision publishedVersion`;

export async function layoutOf(admin: ApiSession, type: LayoutKind, pageId?: string) {
    const { bdPageLayout } = await admin.query(
        `query ($type: String!, $pageId: ID) { bdPageLayout(type: $type, pageId: $pageId) { ${LAYOUT} } }`,
        { type, pageId },
    );
    return bdPageLayout as { id: string; draftRevision: number; publishedVersion: number };
}

/** Replaces the draft, whatever is there. */
export async function setDraft(
    admin: ApiSession,
    type: LayoutKind,
    document: LayoutDocument,
    pageId?: string,
) {
    const layout = await layoutOf(admin, type, pageId);
    const { saveBdLayoutDraft } = await admin.query(
        `mutation ($id: ID!, $document: JSON!, $base: Int!) {
            saveBdLayoutDraft(layoutId: $id, document: $document, baseRevision: $base, force: true) {
                layout { ${LAYOUT} } errors { code }
            }
        }`,
        { id: layout.id, document, base: layout.draftRevision },
    );
    if (!saveBdLayoutDraft.layout)
        throw new Error(`Draft refused: ${JSON.stringify(saveBdLayoutDraft.errors)}`);
    return saveBdLayoutDraft.layout as { id: string; draftRevision: number; publishedVersion: number };
}

/** Makes `document` the live layout (and the draft). */
export async function publishLayout(
    admin: ApiSession,
    type: LayoutKind,
    document: LayoutDocument,
    pageId?: string,
) {
    const layout = await setDraft(admin, type, document, pageId);
    const { publishBdLayout } = await admin.query(
        `mutation ($id: ID!, $base: Int!) { publishBdLayout(layoutId: $id, baseVersion: $base, force: true) {
            layout { ${LAYOUT} } errors { code }
        } }`,
        { id: layout.id, base: layout.publishedVersion },
    );
    if (!publishBdLayout.layout)
        throw new Error(`Publish refused: ${JSON.stringify(publishBdLayout.errors)}`);
    return publishBdLayout.layout as { id: string; draftRevision: number; publishedVersion: number };
}

/** The home page a new store has: its name, the main categories, new products, trust badges. */
export async function resetHome(admin: ApiSession) {
    const { bdStoreSettings } = await admin.query('{ bdStoreSettings { settings } }');
    const { storeName, shortDescription } = bdStoreSettings.settings.profile;
    await publishLayout(admin, 'home', defaultHomeLayout({ name: storeName, description: shortDescription }));
}

export async function setTheme(admin: ApiSession, settings: ThemeSettings = defaultThemeSettings('minimal')) {
    const { updateBdThemeSettings } = await admin.query(
        'mutation ($input: JSON!) { updateBdThemeSettings(input: $input) { errors { path code } } }',
        { input: settings },
    );
    if (updateBdThemeSettings.errors.length) throw new Error(JSON.stringify(updateBdThemeSettings.errors));
}

/** Waits until the storefront page's HTML passes `check` (the data cache is purged on publish). */
export async function waitForStorefront(url: string, check: (html: string) => boolean, timeoutMs = 10_000) {
    const started = Date.now();
    for (;;) {
        const html = await (await fetch(url, { headers: { 'cache-control': 'no-cache' } })).text();
        if (check(html)) return html;
        if (Date.now() - started > timeoutMs) throw new Error(`Storefront page never changed: ${url}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

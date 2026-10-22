import { createSection, type LayoutDocument } from '@ecommbd/sections';
import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BdSectionsPlugin, createPreviewToken } from '../../src/plugins/bd-sections';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3069;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

const LAYOUT_FIELDS = `
    id
    type
    pageId
    title
    draft
    draftRevision
    draftSavedBy
    publishedVersion
    publishedBy
    hasChanges
    warnings { sectionId blockId field code }
`;
const RESULT_FIELDS = `
    layout { ${LAYOUT_FIELDS} }
    errors { sectionId blockId field code }
    conflict { by publishedVersion draftRevision }
`;
const GET_LAYOUT = gql`
    query ($type: String!, $pageId: ID) {
        bdPageLayout(type: $type, pageId: $pageId) { ${LAYOUT_FIELDS} }
    }
`;
const SAVE_DRAFT = gql`
    mutation ($layoutId: ID!, $document: JSON!, $baseRevision: Int!, $force: Boolean) {
        saveBdLayoutDraft(layoutId: $layoutId, document: $document, baseRevision: $baseRevision, force: $force) {
            ${RESULT_FIELDS}
        }
    }
`;
const PUBLISH = gql`
    mutation ($layoutId: ID!, $baseVersion: Int!, $force: Boolean) {
        publishBdLayout(layoutId: $layoutId, baseVersion: $baseVersion, force: $force) { ${RESULT_FIELDS} }
    }
`;
const VERSIONS = gql`
    query ($layoutId: ID!) {
        bdLayoutVersions(layoutId: $layoutId) {
            version
            publishedBy
            sectionCount
        }
    }
`;
const RESTORE = gql`
    mutation ($layoutId: ID!, $version: Int!) {
        restoreBdLayoutVersion(layoutId: $layoutId, version: $version) { ${RESULT_FIELDS} }
    }
`;
const DISCARD = gql`
    mutation ($layoutId: ID!) {
        discardBdLayoutDraft(layoutId: $layoutId) { ${RESULT_FIELDS} }
    }
`;
const PREVIEW_LINK = gql`
    mutation ($layoutId: ID!, $language: String!, $share: Boolean) {
        createBdPreviewLink(layoutId: $layoutId, language: $language, share: $share) {
            url
            token
            expiresAt
        }
    }
`;
const SHOP_LAYOUT = gql`
    query ($type: String!, $pageId: ID) {
        bdLayout(type: $type, pageId: $pageId) {
            id
            type
            pageId
            version
            document
            assets {
                id
                preview
            }
        }
    }
`;
const SHOP_PREVIEW = gql`
    query ($token: String!) {
        bdLayoutPreview(token: $token) {
            mode
            expiresAt
            layout {
                id
                type
                version
                document
            }
        }
    }
`;
const SAVE_PAGE = gql`
    mutation ($input: JSON!) {
        saveBdPage(input: $input) {
            page {
                id
            }
            errors {
                path
                code
            }
        }
    }
`;
const THEME = gql`
    query {
        bdThemeSettings
    }
`;
const UPDATE_THEME = gql`
    mutation ($input: JSON!) {
        updateBdThemeSettings(input: $input) {
            settings
            errors {
                path
                code
                ratio
            }
            warnings {
                path
                code
                ratio
            }
        }
    }
`;

interface Layout {
    id: string;
    type: string;
    pageId: string | null;
    title: string;
    draft: LayoutDocument;
    draftRevision: number;
    draftSavedBy: string;
    publishedVersion: number;
    publishedBy: string;
    hasChanges: boolean;
    warnings: Array<{ sectionId: string; blockId: string | null; field: string; code: string }>;
}
interface Result {
    layout: Layout | null;
    errors: Array<{ sectionId: string; field: string; code: string }>;
    conflict: { by: string; publishedVersion: number; draftRevision: number } | null;
}

async function layoutOf(type: string, pageId?: string): Promise<Layout> {
    return (await adminClient.query(GET_LAYOUT, { type, pageId })).bdPageLayout;
}

async function saveDraft(
    layout: Layout,
    document: unknown,
    baseRevision = layout.draftRevision,
    force?: boolean,
) {
    return (await adminClient.query(SAVE_DRAFT, { layoutId: layout.id, document, baseRevision, force }))
        .saveBdLayoutDraft as Result;
}

async function publish(layoutId: string, baseVersion: number, force?: boolean) {
    return (await adminClient.query(PUBLISH, { layoutId, baseVersion, force })).publishBdLayout as Result;
}

async function createPage(slug: string) {
    const page = (text: string) => ({ title: text, slug, body: '', seoTitle: '', seoDescription: '' });
    const { saveBdPage } = await adminClient.query(SAVE_PAGE, {
        input: { enabled: true, translations: { bn: page('আমাদের কথা'), en: page('About us') } },
    });
    return saveBdPage.page.id as string;
}

async function createStaff(email: string, roleCode: string) {
    const { roles } = await adminClient.query(gql`
        query {
            roles(options: { take: 100 }) {
                items {
                    id
                    code
                    permissions
                }
            }
        }
    `);
    const role = roles.items.find((item: { code: string }) => item.code === roleCode);
    await adminClient.query(
        gql`
            mutation ($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                firstName: 'Rahim',
                lastName: roleCode,
                emailAddress: email,
                password: 'staff-password-123',
                roleIds: [role.id],
            },
        },
    );
    return roles.items as Array<{ code: string; permissions: string[] }>;
}

describe('page sections (phase 15)', () => {
    beforeAll(async () => {
        await server.init({ initialData: testInitialData, customerCount: 0 });
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('gives EditStorefront to the owner, manager and marketing roles', async () => {
        const roles = await createStaff('owner@example.com', 'owner');
        await createStaff('marketing@example.com', 'marketing');
        await createStaff('orders@example.com', 'order-staff');
        const editors = roles
            .filter(
                role => role.permissions.includes('EditStorefront') && role.code !== '__super_admin_role__',
            )
            .map(role => role.code)
            .sort();
        expect(editors).toEqual(['manager', 'marketing', 'owner']);
    });

    it('starts the home page from the default layout, unpublished', async () => {
        const home = await layoutOf('home');
        expect(home).toMatchObject({
            type: 'home',
            pageId: null,
            draftRevision: 0,
            publishedVersion: 0,
            hasChanges: true,
        });
        expect(home.draft.sections.map(section => section.type)).toEqual([
            'hero',
            'collection-list',
            'product-grid',
            'trust-badges',
        ]);
        // The same row every time.
        expect((await layoutOf('home')).id).toBe(home.id);
        expect((await shopClient.query(SHOP_LAYOUT, { type: 'home' })).bdLayout).toBeNull();
        expect((await adminClient.query(GET_LAYOUT, { type: 'landing' })).bdPageLayout).toBeNull();
        expect((await adminClient.query(GET_LAYOUT, { type: 'page' })).bdPageLayout).toBeNull();
        expect(
            (await adminClient.query(GET_LAYOUT, { type: 'page', pageId: '999' })).bdPageLayout,
        ).toBeNull();
    });

    it('autosaves drafts: reads them for this release, sanitizes rich text and notes who saved', async () => {
        await adminClient.asUserWithCredentials('owner@example.com', 'staff-password-123');
        const home = await layoutOf('home');
        const text = createSection('rich-text');
        text.settings.text = {
            bn: '<p>নিরাপদ</p><script>alert(1)</script><img src="https://evil.example/x.png">',
            en: '',
        };
        const result = await saveDraft(home, {
            sections: [text, { uid: 'zzzz0000', type: 'custom-html', settings: { html: '<script>' } }],
        });
        expect(result.errors).toEqual([]);
        expect(result.conflict).toBeNull();
        expect(result.layout).toMatchObject({ draftRevision: 1, draftSavedBy: 'Rahim owner' });
        expect(result.layout!.draft.sections).toHaveLength(1);
        // Phase 12's sanitizer: no script, no image from another site.
        const saved = (result.layout!.draft.sections[0]!.settings.text as { bn: string }).bn;
        expect(saved).toMatch(/^<p>নিরাপদ<\/p>/);
        expect(saved).not.toMatch(/script|evil/);
        await adminClient.asSuperAdmin();
    });

    it('refuses an autosave from an older revision unless forced', async () => {
        const home = await layoutOf('home');
        const stale = await saveDraft(home, { sections: [] }, home.draftRevision - 1);
        expect(stale).toMatchObject({
            layout: null,
            conflict: { by: 'Rahim owner', draftRevision: home.draftRevision },
        });
        const forced = await saveDraft(
            home,
            { sections: [createSection('divider')] },
            home.draftRevision - 1,
            true,
        );
        expect(forced.layout!.draftRevision).toBe(home.draftRevision + 1);
        expect(forced.layout!.draft.sections.map(section => section.type)).toEqual(['divider']);
    });

    it('refuses more than 40 sections', async () => {
        const home = await layoutOf('home');
        const many = Array.from({ length: 41 }, () => createSection('divider'));
        const result = await saveDraft(home, { sections: many });
        expect(result.errors).toEqual([
            { sectionId: '', blockId: null, field: 'sections', code: 'tooManySections' },
        ]);
    });

    it('publishes: the storefront gets the sections with links resolved, then a stale publish is a conflict', async () => {
        const pageId = await createPage('about-us');
        const home = await layoutOf('home');
        const hero = createSection('hero');
        hero.settings.link = { type: 'page', ref: pageId };
        hero.settings.secondLink = { type: 'anchor', anchor: 'faq' };
        const faq = createSection('faq');
        faq.style.anchor = 'faq';
        await saveDraft(home, { sections: [hero, faq] });

        const first = await publish(home.id, 0);
        expect(first.layout).toMatchObject({
            publishedVersion: 1,
            publishedBy: 'Super Admin',
            hasChanges: false,
        });
        const { bdLayout } = await shopClient.query(SHOP_LAYOUT, { type: 'home' }, { languageCode: 'en' });
        expect(bdLayout).toMatchObject({ type: 'home', version: 1, assets: [] });
        expect(bdLayout.document.sections[0].settings.link).toEqual({
            type: 'page',
            ref: pageId,
            href: '/about-us/',
        });
        expect(bdLayout.document.sections[0].settings.secondLink).toEqual({
            type: 'anchor',
            anchor: 'faq',
            href: '#faq',
        });
        expect(bdLayout.document.sections[0].settings.button).toEqual({ bn: 'এখনই কিনুন', en: 'Shop now' });

        // Rahim publishes from version 1; a second editor still on version 1 is told who.
        await adminClient.asUserWithCredentials('marketing@example.com', 'staff-password-123');
        expect((await publish(home.id, 1)).layout!.publishedVersion).toBe(2);
        await adminClient.asSuperAdmin();
        const stale = await publish(home.id, 1);
        expect(stale).toMatchObject({
            layout: null,
            conflict: { by: 'Rahim marketing', publishedVersion: 2 },
        });
        expect((await publish(home.id, 1, true)).layout!.publishedVersion).toBe(3);
    });

    it('purges the storefront’s cached layouts on publish', async () => {
        const prefix = `${BdSectionsPlugin.options.redisKeyPrefix}:sf:`;
        const redis = new Redis({
            host: '127.0.0.1',
            port: Number(process.env.TEST_REDIS_CACHE_PORT ?? 63791),
        });
        const subscriber = redis.duplicate();
        const messages: string[] = [];
        await subscriber.subscribe(`${prefix}purge`);
        subscriber.on('message', (_channel, message) => messages.push(message));
        await redis.set(`${prefix}data:layout:home:bn`, '{}');
        await redis.sadd(`${prefix}tag:layouts`, 'layout:home:bn');
        const home = await layoutOf('home');
        await publish(home.id, home.publishedVersion);
        expect(await redis.exists(`${prefix}data:layout:home:bn`)).toBe(0);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(messages).toContain('layouts');
        subscriber.disconnect();
        redis.disconnect();
    });

    it('refuses to publish broken links and repeated anchors, naming the section', async () => {
        const home = await layoutOf('home');
        const banner = createSection('banner');
        banner.settings.link = { type: 'url', url: 'javascript:alert(1)' };
        await saveDraft(home, { sections: [banner] });
        const result = await publish(home.id, home.publishedVersion);
        expect(result.errors).toEqual([
            { sectionId: banner.uid, blockId: null, field: 'link', code: 'invalidUrl' },
        ]);
        expect((await layoutOf('home')).publishedVersion).toBe(home.publishedVersion);
    });

    it('warns about missing products, categories and images, and empty pickers', async () => {
        const home = await layoutOf('home');
        const grid = createSection('product-grid');
        grid.settings.source = 'manual';
        const featured = createSection('featured-product');
        featured.settings.product = '9999';
        const hero = createSection('hero');
        hero.settings.image = { assetId: '8888', preview: '/assets/gone.jpg' };
        const list = createSection('collection-list');
        list.settings.collections = ['7777'];
        const result = await saveDraft(home, { sections: [grid, featured, hero, list] });
        expect(result.layout!.warnings).toEqual(
            expect.arrayContaining([
                { sectionId: grid.uid, blockId: null, field: 'products', code: 'noProducts' },
                { sectionId: featured.uid, blockId: null, field: '', code: 'productMissing' },
                { sectionId: hero.uid, blockId: null, field: '', code: 'imageMissing' },
                { sectionId: list.uid, blockId: null, field: '', code: 'collectionMissing' },
            ]),
        );
        expect(result.layout!.warnings).toHaveLength(4);
    });

    it('keeps the last 20 published versions; restoring or discarding puts one back in the draft', async () => {
        const home = await layoutOf('home');
        let version = home.publishedVersion;
        for (let count = 1; count <= 22; count++) {
            const sections = Array.from({ length: count % 5 }, () => createSection('divider'));
            const saved = await saveDraft(await layoutOf('home'), { sections });
            expect(saved.layout).not.toBeNull();
            version = (await publish(home.id, version)).layout!.publishedVersion;
        }
        const { bdLayoutVersions } = await adminClient.query(VERSIONS, { layoutId: home.id });
        expect(bdLayoutVersions).toHaveLength(20);
        expect(bdLayoutVersions[0]).toMatchObject({
            version,
            publishedBy: 'Super Admin',
            sectionCount: 22 % 5,
        });
        expect(bdLayoutVersions[19].version).toBe(version - 19);

        const restored = (await adminClient.query(RESTORE, { layoutId: home.id, version: version - 1 }))
            .restoreBdLayoutVersion as Result;
        expect(restored.layout!.draft.sections).toHaveLength(21 % 5);
        expect(restored.layout!.hasChanges).toBe(true);
        expect(
            (await shopClient.query(SHOP_LAYOUT, { type: 'home' })).bdLayout.document.sections,
        ).toHaveLength(22 % 5);
        const discarded = (await adminClient.query(DISCARD, { layoutId: home.id }))
            .discardBdLayoutDraft as Result;
        expect(discarded.layout!.hasChanges).toBe(false);
        const gone = (await adminClient.query(RESTORE, { layoutId: home.id, version: 1 }))
            .restoreBdLayoutVersion;
        expect(gone.errors).toEqual([{ sectionId: '', blockId: null, field: 'version', code: 'notFound' }]);
    });

    it('previews drafts with a signed, short-lived token for this store only', async () => {
        const home = await layoutOf('home');
        await saveDraft(home, { sections: [createSection('faq')] });
        const { createBdPreviewLink } = await adminClient.query(PREVIEW_LINK, {
            layoutId: home.id,
            language: 'en',
            share: true,
        });
        expect(createBdPreviewLink.url).toBe(
            `https://shop.example.com/en/?preview=${createBdPreviewLink.token}`,
        );
        const minutes = (Date.parse(createBdPreviewLink.expiresAt) - Date.now()) / 60_000;
        expect(minutes).toBeGreaterThan(29);
        expect(minutes).toBeLessThanOrEqual(30);

        const { bdLayoutPreview } = await shopClient.query(SHOP_PREVIEW, {
            token: createBdPreviewLink.token,
        });
        expect(bdLayoutPreview).toMatchObject({ mode: 'share', layout: { id: home.id, type: 'home' } });
        expect(
            bdLayoutPreview.layout.document.sections.map((section: { type: string }) => section.type),
        ).toEqual(['faq']);

        const tampered = createBdPreviewLink.token.replace(/.$/, (char: string) =>
            char === 'A' ? 'B' : 'A',
        );
        const secret = BdSectionsPlugin.options.secret;
        const { channel } = await shopClient
            .query(gql`
                query {
                    activeChannel {
                        token
                    }
                }
            `)
            .then(result => ({ channel: result.activeChannel.token as string }));
        const expired = createPreviewToken(
            { layoutId: home.id, channel, mode: 'share', expires: Math.floor(Date.now() / 1000) - 1 },
            secret,
        );
        const otherStore = createPreviewToken(
            {
                layoutId: home.id,
                channel: 'another-channel',
                mode: 'share',
                expires: Math.floor(Date.now() / 1000) + 60,
            },
            secret,
        );
        for (const token of [tampered, expired, otherStore, 'nonsense', `${'a'.repeat(500)}.b`]) {
            expect((await shopClient.query(SHOP_PREVIEW, { token })).bdLayoutPreview).toBeNull();
        }
        const editor = (await adminClient.query(PREVIEW_LINK, { layoutId: home.id, language: 'bn' }))
            .createBdPreviewLink;
        expect(editor.url).toBe(`https://shop.example.com/?preview=${editor.token}`);
        expect((Date.parse(editor.expiresAt) - Date.now()) / 60_000).toBeLessThanOrEqual(15);
    });

    it('gives each page its own sections, and copies them with the page', async () => {
        const pageId = await createPage('size-guide');
        const page = await layoutOf('page', pageId);
        expect(page).toMatchObject({ type: 'page', pageId, title: 'আমাদের কথা', draft: { sections: [] } });
        await saveDraft(page, { sections: [createSection('rich-text'), createSection('faq')] });
        await publish(page.id, 0);
        const { bdLayout } = await shopClient.query(SHOP_LAYOUT, { type: 'page', pageId });
        expect(bdLayout.document.sections).toHaveLength(2);
        const link = (await adminClient.query(PREVIEW_LINK, { layoutId: page.id, language: 'en' }))
            .createBdPreviewLink;
        expect(link.url).toMatch(/^https:\/\/shop\.example\.com\/en\/size-guide\/\?preview=/);

        const { duplicateBdPage } = await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    duplicateBdPage(id: $id) {
                        id
                        enabled
                        translations {
                            languageCode
                            title
                            slug
                        }
                    }
                }
            `,
            { id: pageId },
        );
        expect(duplicateBdPage.enabled).toBe(false);
        expect(duplicateBdPage.translations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    languageCode: 'en',
                    title: 'About us (copy)',
                    slug: 'size-guide-copy',
                }),
                expect.objectContaining({ languageCode: 'bn', title: 'আমাদের কথা (কপি)' }),
            ]),
        );
        const copy = await layoutOf('page', duplicateBdPage.id);
        expect(copy.draft.sections.map(section => section.type)).toEqual(['rich-text', 'faq']);
        expect(copy.publishedVersion).toBe(0);
        const again = (
            await adminClient.query(
                gql`
                    mutation ($id: ID!) {
                        duplicateBdPage(id: $id) {
                            translations {
                                languageCode
                                slug
                            }
                        }
                    }
                `,
                { id: pageId },
            )
        ).duplicateBdPage;
        expect(
            again.translations.find((item: { languageCode: string }) => item.languageCode === 'en').slug,
        ).toBe('size-guide-copy-2');
    });

    it('saves sections for reuse', async () => {
        const banner = createSection('banner');
        banner.style.background = 'dark';
        const SAVE = gql`
            mutation ($name: String!, $section: JSON!) {
                saveBdSection(name: $name, section: $section) {
                    id
                    name
                    section
                    createdBy
                }
            }
        `;
        const { saveBdSection } = await adminClient.query(SAVE, { name: '  Eid   banner ', section: banner });
        expect(saveBdSection).toMatchObject({
            name: 'Eid banner',
            createdBy: 'Super Admin',
            section: { type: 'banner', style: { background: 'dark' } },
        });
        await expect(adminClient.query(SAVE, { name: 'x', section: { type: 'nope' } })).rejects.toThrow(
            /Not a section/,
        );
        const LIST = gql`
            query {
                bdSavedSections {
                    id
                    name
                }
            }
        `;
        expect((await adminClient.query(LIST)).bdSavedSections).toEqual([
            { id: saveBdSection.id, name: 'Eid banner' },
        ]);
        const DELETE = gql`
            mutation ($id: ID!) {
                deleteBdSavedSection(id: $id)
            }
        `;
        expect((await adminClient.query(DELETE, { id: saveBdSection.id })).deleteBdSavedSection).toBe(true);
        expect((await adminClient.query(LIST)).bdSavedSections).toEqual([]);
    });

    it('saves theme settings only with readable text, and serves them to the storefront', async () => {
        expect((await adminClient.query(THEME)).bdThemeSettings).toMatchObject({
            theme: 'minimal',
            font: 'system',
        });
        const low = (
            await adminClient.query(UPDATE_THEME, {
                input: { theme: 'minimal', colours: { text: '#cccccc' } },
            })
        ).updateBdThemeSettings;
        expect(low).toMatchObject({
            settings: null,
            errors: [{ path: 'colours.text', code: 'lowContrast' }],
        });
        const saved = (
            await adminClient.query(UPDATE_THEME, {
                input: {
                    theme: 'bazaar',
                    colours: { background: '#ffffff', text: '#1a1a1a', accent: '#006a4e', sale: '#c8102e' },
                    font: 'noto-serif-bengali',
                },
            })
        ).updateBdThemeSettings;
        expect(saved.errors).toEqual([]);
        expect(saved.settings).toMatchObject({ theme: 'bazaar', font: 'noto-serif-bengali', cards: 'card' });
        const { bdTheme } = await shopClient.query(gql`
            query {
                bdTheme
            }
        `);
        expect(bdTheme).toEqual(saved.settings);
    });

    it('needs EditStorefront', async () => {
        await adminClient.asUserWithCredentials('orders@example.com', 'staff-password-123');
        await expect(adminClient.query(GET_LAYOUT, { type: 'home' })).rejects.toThrow(
            /not currently authorized/,
        );
        await expect(adminClient.query(UPDATE_THEME, { input: {} })).rejects.toThrow(
            /not currently authorized/,
        );
        await expect(
            adminClient.query(gql`
                mutation {
                    setSettingsStoreValue(input: { key: "bdSections.theme", value: {} }) {
                        result
                    }
                }
            `),
        ).resolves.toMatchObject({ setSettingsStoreValue: { result: false } });
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(THEME)).rejects.toThrow(/not currently authorized/);
        await adminClient.asSuperAdmin();
    });
});

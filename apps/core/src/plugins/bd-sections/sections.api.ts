import gql from 'graphql-tag';

/** Shop API: published layouts, previews and the theme for the storefront (roadmap phase 15). */
export const sectionsShopApiExtensions = gql`
    type BdLayout {
        id: ID!
        "home, page or product"
        type: String!
        pageId: ID
        "The published version, or the draft's revision in a preview"
        version: Int!
        "LayoutDocument from @ecommbd/sections; links carry href in the request's language"
        document: JSON!
        "The images the sections show (deleted ones are missing: show a placeholder)"
        assets: [Asset!]!
    }

    type BdLayoutPreview {
        layout: BdLayout!
        "editor (the page editor's frame) or share (a link sent to someone)"
        mode: String!
        expiresAt: DateTime!
    }

    extend type Query {
        "The published sections of the home page, the product page template or a page; null when none are published"
        bdLayout(type: String!, pageId: ID): BdLayout
        "A layout's draft, for a valid preview token; null when the token is wrong or expired"
        bdLayoutPreview(token: String!): BdLayoutPreview
        "ThemeSettings from @ecommbd/sections"
        bdTheme: JSON!
    }
`;

/** Admin API: the page editor and the theme screen (EditStorefront). */
export const sectionsAdminApiExtensions = gql`
    type BdLayoutWarning {
        sectionId: String!
        blockId: String
        "A field name, style.anchor or sections"
        field: String!
        "invalidUrl, invalidAnchor, invalidVideo, duplicateAnchor, tooManySections (errors); productMissing, collectionMissing, pageMissing, imageMissing, noProducts, noProduct, manySections (warnings)"
        code: String!
    }

    type BdPageLayout {
        id: ID!
        "home, page or product"
        type: String!
        pageId: ID
        "The page's title, for pages"
        title: String!
        "LayoutDocument from @ecommbd/sections"
        draft: JSON!
        draftRevision: Int!
        draftSavedAt: DateTime
        draftSavedBy: String!
        "0 until first published"
        publishedVersion: Int!
        publishedAt: DateTime
        publishedBy: String!
        "The draft differs from what's live"
        hasChanges: Boolean!
        "Missing products, images and the like, shown on their sections"
        warnings: [BdLayoutWarning!]!
    }

    type BdLayoutConflict {
        "Who saved or published the newer version"
        by: String!
        at: DateTime
        publishedVersion: Int!
        draftRevision: Int!
    }

    type BdLayoutResult {
        "The layout after the change; null when nothing changed"
        layout: BdPageLayout
        "What stops publishing or saving"
        errors: [BdLayoutWarning!]!
        "Someone else saved or published since this editor loaded"
        conflict: BdLayoutConflict
    }

    type BdLayoutVersion {
        version: Int!
        publishedAt: DateTime!
        publishedBy: String!
        sectionCount: Int!
    }

    type BdPreviewLink {
        "The storefront page with the token"
        url: String!
        token: String!
        expiresAt: DateTime!
    }

    type BdSavedSection {
        id: ID!
        name: String!
        "SectionData from @ecommbd/sections"
        section: JSON!
        createdAt: DateTime!
        createdBy: String!
    }

    type BdThemeProblem {
        "colours.text, colours.accent…"
        path: String!
        "invalidColour or lowContrast"
        code: String!
        ratio: Float
    }

    type BdThemeResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdThemeProblem!]!
        warnings: [BdThemeProblem!]!
    }

    extend type Query {
        "The layout of the home page (home), the product page template (product) or a page (page with pageId); made on first use"
        bdPageLayout(type: String!, pageId: ID): BdPageLayout
        "Newest first, at most 20"
        bdLayoutVersions(layoutId: ID!): [BdLayoutVersion!]!
        bdSavedSections: [BdSavedSection!]!
        "ThemeSettings from @ecommbd/sections"
        bdThemeSettings: JSON!
    }

    extend type Mutation {
        "Autosave. baseRevision: the draftRevision this editor last saw; force overwrites a newer draft"
        saveBdLayoutDraft(layoutId: ID!, document: JSON!, baseRevision: Int!, force: Boolean): BdLayoutResult!
        "baseVersion: the publishedVersion this editor last saw; force publishes over a newer one"
        publishBdLayout(layoutId: ID!, baseVersion: Int!, force: Boolean): BdLayoutResult!
        "Puts a published version back into the draft (publish to make it live)"
        restoreBdLayoutVersion(layoutId: ID!, version: Int!): BdLayoutResult!
        "Puts the live version back into the draft"
        discardBdLayoutDraft(layoutId: ID!): BdLayoutResult!
        "language: bn or en; share: a link for someone else (30 minutes) instead of the editor's frame (15)"
        createBdPreviewLink(layoutId: ID!, language: String!, share: Boolean): BdPreviewLink!
        saveBdSection(name: String!, section: JSON!): BdSavedSection!
        deleteBdSavedSection(id: ID!): Boolean!
        "A copy of a page (disabled, with \\"copy\\" slugs) and its sections as a draft"
        duplicateBdPage(id: ID!): BdPage
        updateBdThemeSettings(input: JSON!): BdThemeResult!
    }
`;

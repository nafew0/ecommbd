import gql from 'graphql-tag';

/** Pages, menus and slug history (roadmap phase 12). */
const sharedTypes = `
    type BdPageTranslation {
        "bn or en"
        languageCode: String!
        title: String!
        "As Vendure stores slugs (NFD); write it in URLs NFC-encoded"
        slug: String!
        "Sanitized HTML, or plain text with line breaks"
        body: String!
        seoTitle: String!
        seoDescription: String!
    }

    type BdPage {
        id: ID!
        updatedAt: DateTime!
        enabled: Boolean!
        "One per language that has a title"
        translations: [BdPageTranslation!]!
    }
`;

export const contentShopApiExtensions = gql`
    ${sharedTypes}

    type BdMenuLink {
        label: String!
        "A path without the language prefix (/product-category/saree/), or a full URL"
        url: String!
        children: [BdMenuLink!]!
    }

    type BdMenus {
        header: [BdMenuLink!]!
        footer: [BdMenuLink!]!
    }

    type BdSlugLookup {
        "moved or gone"
        status: String!
        "The current slug, when moved"
        slug: String
    }

    extend type Query {
        "An enabled page with this slug in any language"
        bdPage(slug: String!): BdPage
        "Enabled pages, for the sitemap"
        bdPages: [BdPage!]!
        "In the request's language"
        bdMenus: BdMenus!
        "What an unknown product, collection or page slug means: moved (with the current slug) or gone"
        bdSlugLookup(type: String!, slug: String!): BdSlugLookup
    }
`;

export const contentAdminApiExtensions = gql`
    ${sharedTypes}

    type BdPageList {
        items: [BdPage!]!
        totalItems: Int!
    }

    type BdContentFieldError {
        "Dotted path, e.g. translations.bn.slug"
        path: String!
        "required, tooLong, tooMany, invalid, invalidUrl, reserved, taken, notFound"
        code: String!
    }

    type BdSavePageResult {
        page: BdPage
        errors: [BdContentFieldError!]!
    }

    type BdUpdateMenusResult {
        "Menus from @ecommbd/shared, or null when there are errors"
        menus: JSON
        errors: [BdContentFieldError!]!
    }

    extend type Query {
        bdPages(skip: Int, take: Int): BdPageList!
        bdPage(id: ID!): BdPage
        "Menus from @ecommbd/shared (links store IDs)"
        bdMenus: JSON!
    }

    extend type Mutation {
        "PageInput from @ecommbd/shared. Without an id, creates a page."
        saveBdPage(id: ID, input: JSON!): BdSavePageResult!
        "Its URLs then answer 410 Gone"
        deleteBdPage(id: ID!): Boolean!
        updateBdMenus(input: JSON!): BdUpdateMenusResult!
    }
`;

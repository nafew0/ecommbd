import { graphql } from './core';

/** Every Shop API query the storefront sends (roadmap phase 12). */

export const AssetFields = graphql(`
    fragment AssetFields on Asset @_unmask {
        id
        name
        preview
        width
        height
        customFields {
            bdImage {
                status
                width
                height
                srcset
                variants {
                    width
                    height
                    url
                }
            }
        }
    }
`);

export const ProductCardFields = graphql(
    `
        fragment ProductCardFields on Product @_unmask {
            id
            name
            slug
            customFields {
                isNew
            }
            featuredAsset {
                ...AssetFields
            }
            variants {
                id
                priceWithTax
                stockLevel
                customFields {
                    oldPrice
                }
            }
        }
    `,
    [AssetFields],
);

export const SETTINGS = graphql(
    `
        query StoreSettings {
            bdStoreSettings {
                profile {
                    storeName {
                        bn
                        en
                    }
                    logo {
                        ...AssetFields
                    }
                    favicon {
                        preview
                    }
                    phones
                    whatsapp
                    messengerUrl
                    email
                    address {
                        line
                        area
                    }
                    tradeLicenceNumber
                    social {
                        facebook
                        instagram
                        youtube
                        tiktok
                    }
                    businessHours {
                        bn
                        en
                    }
                    shortDescription {
                        bn
                        en
                    }
                }
                policies {
                    returnPolicy {
                        bn
                        en
                    }
                    refundPolicy {
                        bn
                        en
                    }
                    privacyPolicy {
                        bn
                        en
                    }
                    terms {
                        bn
                        en
                    }
                }
                locale {
                    defaultLanguage
                    banglaDigits
                }
            }
        }
    `,
    [AssetFields],
);

export const MENUS = graphql(`
    query Menus {
        bdMenus {
            header {
                label
                url
                children {
                    label
                    url
                }
            }
            footer {
                label
                url
            }
        }
    }
`);

export const TOP_COLLECTIONS = graphql(
    `
        query TopCollections {
            collections(options: { topLevelOnly: true, take: 50, sort: { position: ASC } }) {
                items {
                    id
                    name
                    slug
                    featuredAsset {
                        ...AssetFields
                    }
                }
            }
        }
    `,
    [AssetFields],
);

export const NEW_PRODUCTS = graphql(
    `
        query NewProducts($take: Int!) {
            products(options: { take: $take, sort: { createdAt: DESC } }) {
                items {
                    ...ProductCardFields
                }
            }
        }
    `,
    [ProductCardFields],
);

export const PRODUCT = graphql(
    `
        query Product($slug: String!) {
            product(slug: $slug) {
                id
                name
                slug
                description
                updatedAt
                customFields {
                    seoTitle
                    seoDescription
                    shortDescription
                    isNew
                }
                translations {
                    languageCode
                    slug
                }
                featuredAsset {
                    ...AssetFields
                }
                assets {
                    ...AssetFields
                }
                facetValues {
                    code
                    name
                    facet {
                        code
                    }
                }
                optionGroups {
                    name
                }
                variants {
                    id
                    name
                    sku
                    priceWithTax
                    stockLevel
                    options {
                        name
                    }
                    customFields {
                        oldPrice
                        isDefault
                    }
                }
                collections {
                    id
                    slug
                    breadcrumbs {
                        id
                        name
                        slug
                    }
                }
            }
        }
    `,
    [AssetFields],
);

export const COLLECTION = graphql(
    `
        query Collection($slug: String!) {
            collection(slug: $slug) {
                id
                name
                slug
                description
                updatedAt
                customFields {
                    seoTitle
                    seoDescription
                }
                breadcrumbs {
                    id
                    name
                    slug
                }
                translations {
                    languageCode
                    slug
                }
                children {
                    id
                    name
                    slug
                }
                featuredAsset {
                    ...AssetFields
                }
            }
        }
    `,
    [AssetFields],
);

/** A category or search page (phase 13): this page's product IDs, the filters with counts, and more. */
export const BD_SEARCH = graphql(`
    query BdSearch($input: BdSearchInput!) {
        bdSearch(input: $input) {
            totalItems
            productIds
            filters {
                key
                kind
                label
                values {
                    value
                    label
                    count
                    selected
                }
            }
            priceRange {
                min
                max
            }
            inStockCount
            didYouMean
        }
    }
`);

/** The search box's suggestions (phase 13). */
export const BD_SUGGEST = graphql(`
    query BdSuggest($term: String!) {
        bdSearchSuggestions(term: $term) {
            productIds
            collections {
                id
                name
                slugs
            }
            didYouMean
        }
    }
`);

export const PRODUCTS_BY_ID = graphql(
    `
        query ProductsById($ids: [String!]!, $take: Int!) {
            products(options: { filter: { id: { in: $ids } }, take: $take }) {
                items {
                    ...ProductCardFields
                }
            }
        }
    `,
    [ProductCardFields],
);

export const PAGE = graphql(`
    query Page($slug: String!) {
        bdPage(slug: $slug) {
            id
            updatedAt
            translations {
                languageCode
                title
                slug
                body
                seoTitle
                seoDescription
            }
        }
    }
`);

export const SLUG_LOOKUP = graphql(`
    query SlugLookup($type: String!, $slug: String!) {
        bdSlugLookup(type: $type, slug: $slug) {
            status
            slug
        }
    }
`);

export const SITEMAP_PRODUCTS = graphql(`
    query SitemapProducts($skip: Int!) {
        products(options: { take: 100, skip: $skip }) {
            totalItems
            items {
                id
                slug
                updatedAt
                translations {
                    languageCode
                    slug
                }
            }
        }
    }
`);

export const SITEMAP_COLLECTIONS = graphql(`
    query SitemapCollections($skip: Int!) {
        collections(options: { take: 100, skip: $skip }) {
            totalItems
            items {
                id
                updatedAt
                breadcrumbs {
                    slug
                }
            }
        }
    }
`);

export const SITEMAP_PAGES = graphql(`
    query SitemapPages {
        bdPages {
            id
            updatedAt
            translations {
                languageCode
                slug
            }
        }
    }
`);

/** Page sections (phase 15): a published layout with its images. */
const LayoutFields = graphql(
    `
        fragment LayoutFields on BdLayout @_unmask {
            id
            type
            pageId
            version
            document
            assets {
                ...AssetFields
            }
        }
    `,
    [AssetFields],
);

export const LAYOUT = graphql(
    `
        query Layout($type: String!, $pageId: ID) {
            bdLayout(type: $type, pageId: $pageId) {
                ...LayoutFields
            }
        }
    `,
    [LayoutFields],
);

export const LAYOUT_PREVIEW = graphql(
    `
        query LayoutPreview($token: String!) {
            bdLayoutPreview(token: $token) {
                mode
                expiresAt
                layout {
                    ...LayoutFields
                }
            }
        }
    `,
    [LayoutFields],
);

/** A sales page (phase 16): settings, product with its variants, packs, add-on and sections. */
export const SALES_PAGE = graphql(
    `
        query SalesPage($slug: String!, $preview: String) {
            bdSalesPage(slug: $slug, preview: $preview) {
                id
                slug
                title
                settings
                available
                maxQuantity
                preview
                product {
                    id
                    name
                    slug
                    customFields {
                        youtubeUrl
                    }
                    featuredAsset {
                        ...AssetFields
                    }
                    assets {
                        ...AssetFields
                    }
                    variants {
                        id
                        name
                        priceWithTax
                        stockLevel
                        options {
                            name
                        }
                        customFields {
                            oldPrice
                            isDefault
                        }
                    }
                }
                packs {
                    quantity
                    price
                    normalPrice
                    label
                    popular
                    available
                }
                bump {
                    price
                    normalPrice
                    title
                    text
                    variant {
                        id
                        name
                        featuredAsset {
                            ...AssetFields
                        }
                        product {
                            featuredAsset {
                                ...AssetFields
                            }
                        }
                    }
                }
                layout {
                    ...LayoutFields
                }
            }
        }
    `,
    [AssetFields, LayoutFields],
);

export const THEME = graphql(`
    query Theme {
        bdTheme
    }
`);

export const COLLECTIONS_BY_ID = graphql(
    `
        query CollectionsById($ids: [String!]!) {
            collections(options: { filter: { id: { in: $ids } }, take: 50 }) {
                items {
                    id
                    name
                    breadcrumbs {
                        slug
                    }
                    featuredAsset {
                        ...AssetFields
                    }
                }
            }
        }
    `,
    [AssetFields],
);

/** Featured products: the card's fields plus the description. */
export const FEATURED_PRODUCTS = graphql(
    `
        query FeaturedProducts($ids: [String!]!, $take: Int!) {
            products(options: { filter: { id: { in: $ids } }, take: $take }) {
                items {
                    ...ProductCardFields
                    description
                }
            }
        }
    `,
    [ProductCardFields],
);

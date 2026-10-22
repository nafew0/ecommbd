import gql from 'graphql-tag';

/** Shop API: a sales page for the storefront, its order and the shopper's attribution (roadmap phase 16). */
export const salesPagesShopApiExtensions = gql`
    type BdSalesPagePack {
        quantity: Int!
        "The pack's price"
        price: Money!
        "What this many cost at the normal price"
        normalPrice: Money!
        "In the request's language"
        label: String!
        popular: Boolean!
        "False when there isn't enough stock for it"
        available: Boolean!
    }

    type BdSalesPageBump {
        variant: ProductVariant!
        "The add-on's special price for one"
        price: Money!
        normalPrice: Money!
        title: String!
        text: String!
    }

    type BdShopSalesPage {
        id: ID!
        slug: String!
        title: String!
        "SalesPageSettings from @ecommbd/sections"
        settings: JSON!
        product: Product!
        "The product can be ordered (enabled and in stock)"
        available: Boolean!
        "Without packs: the most one order takes"
        maxQuantity: Int!
        packs: [BdSalesPagePack!]!
        "Null when off or out of stock"
        bump: BdSalesPageBump
        "The published sections, or the draft for a preview link"
        layout: BdLayout!
        preview: Boolean!
    }

    enum BdSalesOrderErrorCode {
        NOT_AVAILABLE
        INVALID_VARIANT
        INVALID_PACK
        NOT_ENOUGH_STOCK
        ORDER_LOCKED
    }

    type BdSalesOrderResult {
        "The active order with the page's items, or null when refused"
        order: Order
        errorCode: BdSalesOrderErrorCode
        "With NOT_ENOUGH_STOCK"
        quantityAvailable: Int
    }

    input BdSalesOrderInput {
        slug: String!
        variantId: ID!
        "A pack's quantity, or 1 to 20 when the page has no packs"
        quantity: Int!
        "Add the page's add-on offer"
        bump: Boolean
    }

    input BdAttributionInput {
        source: String
        medium: String
        campaign: String
        content: String
        term: String
        fbclid: String
        gclid: String
        ttclid: String
        "Host name of the site that linked here"
        referrer: String
        "The sales page ID"
        salesPage: String
        "When the visit happened, ms since 1970"
        at: Float
    }

    extend type Query {
        "A sales page by its address; null when there's none, it's off, or its product is gone. preview: a preview token for its draft"
        bdSalesPage(slug: String!, preview: String): BdShopSalesPage
    }

    extend type Mutation {
        "Replaces the active order's items with a sales page's product (a pack or a quantity) and its add-on"
        setBdSalesPageOrder(input: BdSalesOrderInput!): BdSalesOrderResult!
        "Saves where the shopper came from on the active order; values are cut to safe lengths"
        setBdOrderAttribution(input: BdAttributionInput!): Boolean!
    }
`;

/** Admin API: the "Sales pages" screens, the order screen's attribution and orders by campaign. */
export const salesPagesAdminApiExtensions = gql`
    type BdSalesPage {
        id: ID!
        title: String!
        slug: String!
        "The template it was made from"
        template: String!
        "Off: the address shows not found"
        active: Boolean!
        "Null when the product was deleted"
        productId: ID
        "SalesPageSettings from @ecommbd/sections"
        settings: JSON!
        "Its sections, for the page editor (bdPageLayout with type landing)"
        layoutId: ID
        "live, off, notPublished or productMissing"
        status: String!
        "Placed orders from this page"
        orderCount: Int!
        "The storefront address"
        url: String!
        createdBy: String!
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type BdSalesPageList {
        items: [BdSalesPage!]!
        totalItems: Int!
    }

    type BdSalesPageProblem {
        "title, slug, template, productId or settings.<path>"
        field: String!
        "required, invalid, taken, tooMany, notFound, invalidPrice, duplicatePack, tooManyPacks, invalidQuantity, invalidRedirect, bumpIncomplete, bumpMissing, bumpSameProduct"
        code: String!
        "With taken: a free address"
        suggestion: String
    }

    type BdSalesPageResult {
        page: BdSalesPage
        errors: [BdSalesPageProblem!]!
    }

    input BdSalesPageInput {
        title: String
        "Made from the title when empty"
        slug: String
        "For new pages: a template ID from @ecommbd/sections"
        template: String
        productId: ID
        active: Boolean
        "SalesPageSettings from @ecommbd/sections"
        settings: JSON
    }

    type BdSalesPageRef {
        id: ID!
        title: String!
        slug: String!
    }

    type BdOrderAttribution {
        salesPage: BdSalesPageRef
        source: String
        medium: String
        campaign: String
        content: String
        term: String
        fbclid: String
        gclid: String
        ttclid: String
        referrer: String
        at: DateTime
    }

    type BdCampaignRow {
        source: String!
        medium: String!
        campaign: String!
        salesPage: BdSalesPageRef
        orders: Int!
        "Placed order value; null without ReadSalesFigures"
        value: Money
    }

    extend type Order {
        "Where the order came from: its sales page and the ad or link (phase 16)"
        bdAttribution: BdOrderAttribution!
    }

    extend type Query {
        "Newest changes first. search: part of a title or address"
        bdSalesPages(search: String, skip: Int, take: Int): BdSalesPageList!
        bdSalesPage(id: ID!): BdSalesPage
        "Placed orders (not cancelled) per campaign and sales page. Dates are Dhaka days (YYYY-MM-DD)"
        bdOrdersByCampaign(dateFrom: String, dateTo: String): [BdCampaignRow!]!
    }

    extend type Mutation {
        "From a template and a product; its sections start as a draft"
        createBdSalesPage(input: BdSalesPageInput!): BdSalesPageResult!
        updateBdSalesPage(id: ID!, input: BdSalesPageInput!): BdSalesPageResult!
        "A copy with \\"(copy)\\" in its title, a free address and the sections as a draft"
        duplicateBdSalesPage(id: ID!): BdSalesPageResult!
        "Its orders keep their attribution"
        deleteBdSalesPage(id: ID!): Boolean!
    }
`;

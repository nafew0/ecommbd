import gql from 'graphql-tag';

/** Admin API for the product screens (roadmap phase 05). The product form is JSON (@ecommbd/shared catalog). */
export const catalogAdminApiExtensions = gql`
    type BdProductRow {
        id: ID!
        name: String!
        "No Bangla name: the English one is used everywhere"
        banglaMissing: Boolean!
        preview: String
        categoryName: String
        "The cheapest variant's price and old price"
        price: Money!
        oldPrice: Money
        "Available (on hand minus allocated) across variants"
        stock: Int!
        variantCount: Int!
        featured: Boolean!
        isNew: Boolean!
        enabled: Boolean!
    }

    type BdProductList {
        items: [BdProductRow!]!
        totalItems: Int!
    }

    type BdSaveProductResult {
        "The saved product as the form's JSON, or null when there are errors"
        product: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdCategoryName {
        bn: String!
        en: String!
    }

    type BdCategory {
        id: ID!
        name: BdCategoryName!
        preview: String
        assetId: ID
        parentId: ID
        position: Int!
        productCount: Int!
        freeDelivery: Boolean!
    }

    input BdCategoryNameInput {
        bn: String!
        en: String!
    }

    input BdSaveCategoryInput {
        id: ID
        name: BdCategoryNameInput!
        assetId: ID
        parentId: ID
        freeDelivery: Boolean
    }

    type BdStockRow {
        variantId: ID!
        productId: ID!
        name: String!
        sku: String!
        preview: String
        stockOnHand: Int!
        allocated: Int!
        available: Int!
        price: Money!
        "Pre-orders allowed"
        backorder: Boolean!
        low: Boolean!
    }

    type BdStockAdjustment {
        id: ID!
        createdAt: DateTime!
        change: Int!
        stockAfter: Int!
        "recount, received, damaged, gift, returned or other"
        reason: String!
        note: String!
        staffName: String!
    }

    input BdAdjustStockInput {
        variantId: ID!
        "Units added (positive) or removed (negative)"
        change: Int!
        reason: String!
        note: String
    }

    extend type Query {
        bdProducts(search: String, skip: Int, take: Int): BdProductList!
        "The product form's JSON; null when the product doesn't exist"
        bdProductForm(id: ID!): JSON
        bdCategories: [BdCategory!]!
        bdStock(search: String, lowOnly: Boolean, take: Int): [BdStockRow!]!
        bdStockHistory(variantId: ID!): [BdStockAdjustment!]!
    }

    extend type Mutation {
        "Creates or updates a product with its variations, from the form's JSON"
        saveBdProduct(input: JSON!): BdSaveProductResult!
        saveBdCategory(input: BdSaveCategoryInput!): BdCategory!
        moveBdCategory(id: ID!, index: Int!): BdCategory!
        deleteBdCategory(id: ID!): Boolean!
        adjustBdStock(input: BdAdjustStockInput!): BdStockAdjustment!
    }
`;

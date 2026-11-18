import gql from 'graphql-tag';

/** Admin API for brands (roadmap phase 55). A brand is a value of the `brand` facet. */
export const brandAdminApiExtensions = gql`
    type BdBrandText {
        bn: String!
        en: String!
    }

    type BdBrand {
        id: ID!
        "The address part: /brand/<code>"
        code: String!
        name: BdBrandText!
        description: BdBrandText!
        logoAssetId: ID
        logoPreview: String
        "Products with this brand, not counting deleted ones"
        productCount: Int!
    }

    type BdSaveBrandResult {
        brand: BdBrand
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        bdBrands(search: String): [BdBrand!]!
        bdBrand(id: ID!): BdBrand
    }

    extend type Mutation {
        "Creates or updates a brand from JSON (@ecommbd/shared parseBrandInput)"
        saveBdBrand(input: JSON!): BdSaveBrandResult!
        "Deletes a brand. Its products stay, with no brand."
        deleteBdBrand(id: ID!): Boolean!
    }
`;

/** Shop API: one brand for its page, and every brand that has a product on sale (sitemap). */
export const brandShopApiExtensions = gql`
    type BdShopBrand {
        id: ID!
        code: String!
        name: String!
        description: String!
        logo: Asset
    }

    extend type Query {
        bdBrand(code: String!): BdShopBrand
        bdBrands: [BdShopBrand!]!
    }
`;

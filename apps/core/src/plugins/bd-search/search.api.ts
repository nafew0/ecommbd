import gql from 'graphql-tag';

/** Shop API: product search, filters and suggestions for the storefront (roadmap phase 13). */
export const searchShopApiExtensions = gql`
    enum BdSearchSort {
        RELEVANCE
        FEATURED
        NEWEST
        PRICE_ASC
        PRICE_DESC
        POPULAR
    }

    input BdSearchFilterInput {
        "An option dimension (size, colour) or a facet code (tag…)"
        key: String!
        "Option codes or facet value codes; any of them matches"
        values: [String!]!
    }

    input BdSearchInput {
        term: String
        "A category: its products and its subcategories' products"
        collectionId: ID
        filters: [BdSearchFilterInput!]
        "Whole taka"
        priceMin: Int
        "Whole taka"
        priceMax: Int
        inStockOnly: Boolean
        "Default: RELEVANCE with a term, FEATURED without"
        sort: BdSearchSort
        skip: Int
        "At most 48"
        take: Int
        "Count the search if it finds nothing (the results page: page 1, no filters)"
        recordMiss: Boolean
    }

    type BdSearchFilterValue {
        value: String!
        label: String!
        "Products with this value, given the other filters"
        count: Int!
        selected: Boolean!
    }

    type BdSearchFilter {
        key: String!
        "option (size, colour) or facet"
        kind: String!
        "The facet's name; empty for options, which the storefront names"
        label: String!
        values: [BdSearchFilterValue!]!
    }

    type BdPriceRange {
        min: Money!
        max: Money!
    }

    type BdSearchResult {
        totalItems: Int!
        "This page's products, in order"
        productIds: [ID!]!
        filters: [BdSearchFilter!]!
        "Lowest and highest price among the results, ignoring the price filter"
        priceRange: BdPriceRange
        "Results in stock, ignoring the in-stock filter"
        inStockCount: Int!
        "The query with typos corrected, when a word only matched loosely"
        didYouMean: String
    }

    type BdSearchCollection {
        id: ID!
        name: String!
        "From the top category down to this one"
        slugs: [String!]!
    }

    type BdSearchSuggestions {
        productIds: [ID!]!
        collections: [BdSearchCollection!]!
        didYouMean: String
    }

    extend type Query {
        bdSearch(input: BdSearchInput!): BdSearchResult!
        "For the search box: up to 6 products and 3 categories; empty below 2 characters"
        bdSearchSuggestions(term: String!): BdSearchSuggestions!
    }
`;

/** Admin API: synonyms and searches with no results (Online store → Search). */
export const searchAdminApiExtensions = gql`
    type BdSearchMissRow {
        term: String!
        count: Int!
        lastSearchedAt: DateTime!
    }

    type BdSearchSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        "{ synonyms: string[][] }"
        bdSearchSettings: JSON!
        "Searches that found nothing in the last \`days\` days (default 30), most frequent first"
        bdSearchMisses(days: Int, take: Int): [BdSearchMissRow!]!
    }

    extend type Mutation {
        updateBdSearchSettings(input: JSON!): BdSearchSettingsResult!
    }
`;

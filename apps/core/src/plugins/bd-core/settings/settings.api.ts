import gql from 'graphql-tag';

/** Admin API: the full settings (public and private) as JSON, validated by the shared zod schema. */
export const settingsAdminApiExtensions = gql`
    type BdStoreSettingsChange {
        at: DateTime!
        administratorName: String!
        fields: [String!]!
    }

    type BdStoreSettingsPayload {
        "StoreSettings from @ecommbd/shared"
        settings: JSON!
        logo: Asset
        favicon: Asset
        "Newest first, up to 50"
        history: [BdStoreSettingsChange!]!
        "currencyNotBdt, pricesExcludeTax"
        warnings: [String!]!
    }

    type BdSettingsFieldError {
        "Dotted path, e.g. profile.phones.1"
        path: String!
        "required, tooLong, tooMany, invalid, invalidPhone, invalidMobile, invalidEmail, invalidUrl, notFound"
        code: String!
    }

    type BdUpdateStoreSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        bdStoreSettings: BdStoreSettingsPayload!
    }

    extend type Mutation {
        "Needs the UpdateStoreSettings permission. Recorded in the settings history."
        updateBdStoreSettings(input: JSON!): BdUpdateStoreSettingsResult!
    }
`;

/** Shop API: public fields only. Private fields (the owner's phone) don't exist in this schema. */
export const settingsShopApiExtensions = gql`
    type BdBilingualText {
        bn: String!
        en: String!
    }

    type BdStoreAddress {
        line: String!
        area: String!
        districtId: String!
        thanaId: String!
    }

    type BdSocialLinks {
        facebook: String!
        instagram: String!
        youtube: String!
        tiktok: String!
    }

    type BdStoreProfile {
        storeName: BdBilingualText!
        logo: Asset
        favicon: Asset
        "E.164"
        phones: [String!]!
        whatsapp: String!
        messengerUrl: String!
        email: String!
        address: BdStoreAddress!
        tradeLicenceNumber: String!
        social: BdSocialLinks!
        businessHours: BdBilingualText!
        shortDescription: BdBilingualText!
    }

    type BdStorePolicies {
        returnPolicy: BdBilingualText!
        refundPolicy: BdBilingualText!
        privacyPolicy: BdBilingualText!
        terms: BdBilingualText!
    }

    type BdStoreLocale {
        "bn or en"
        defaultLanguage: String!
        banglaDigits: Boolean!
        "numeric or long"
        dateFormat: String!
    }

    type BdPublicStoreSettings {
        profile: BdStoreProfile!
        policies: BdStorePolicies!
        locale: BdStoreLocale!
    }

    extend type Query {
        bdStoreSettings: BdPublicStoreSettings!
    }
`;

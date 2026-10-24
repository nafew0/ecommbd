import gql from 'graphql-tag';

export const metaShopApiExtensions = gql`
    type BdMetaConfig {
        "Empty when Meta tracking is off"
        pixelIds: [String!]!
        "Load Meta's own script in the browser too"
        browserPixel: Boolean!
        "placed, confirmed or delivered: the thank-you page fires Purchase only with placed"
        purchaseTrigger: String!
        "withoutDelivery or withDelivery: the Purchase value"
        purchaseValue: String!
    }

    input BdMetaBrowserInput {
        "The _fbp cookie"
        fbp: String
        "The _fbc cookie"
        fbc: String
        "The shopper's browser"
        userAgent: String
    }

    extend type Query {
        bdMetaConfig: BdMetaConfig!
    }

    extend type Mutation {
        "Saves the Meta cookies and browser on the active order at checkout, for a Purchase sent later"
        setBdMetaBrowser(input: BdMetaBrowserInput!): Boolean!
    }
`;

export const metaAdminApiExtensions = gql`
    type BdMetaPixel {
        pixelId: String!
        tokenSaved: Boolean!
    }

    type BdMetaTokenProblem {
        pixelId: String!
        message: String!
        at: DateTime!
    }

    type BdMetaSetup {
        "MetaSettings from @ecommbd/shared"
        settings: JSON!
        pixels: [BdMetaPixel!]!
        "A token Meta refused: sending is paused until a new one is saved"
        tokenProblem: BdMetaTokenProblem
        keyringConfigured: Boolean!
        graphVersion: String!
    }

    type BdUpdateMetaSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdMetaTestResult {
        ok: Boolean!
        message: String
        eventsReceived: Int
        fbtraceId: String
    }

    type BdMetaEvent {
        id: ID!
        createdAt: DateTime!
        pixelId: String!
        eventName: String!
        eventId: String!
        "browser, server or test"
        source: String!
        orderId: ID
        "queued, sent, failed or skipped"
        status: String!
        eventTime: DateTime!
        "What was sent: hashed customer data only"
        payload: JSON!
        "Meta's answer: events_received, fbtrace_id, messages"
        response: JSON
        error: String
        attempts: Int!
        sentAt: DateTime
    }

    type BdMetaEventList {
        items: [BdMetaEvent!]!
        totalItems: Int!
    }

    extend type Query {
        bdMetaSetup: BdMetaSetup!
        bdMetaEvents(eventName: String, status: String, skip: Int, take: Int): BdMetaEventList!
    }

    extend type Mutation {
        updateBdMetaSettings(input: JSON!): BdUpdateMetaSettingsResult!
        "The Conversions API token for a Pixel; never sent back"
        saveBdMetaToken(pixelId: String!, token: String!): [BdSettingsFieldError!]!
        sendBdMetaTestEvent(pixelId: String!): BdMetaTestResult!
    }
`;

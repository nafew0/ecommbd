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

    "A Pixel whose events are held until a new token is saved (or a test event works)"
    type BdMetaPixelHold {
        pixelId: String!
        "token: Meta refused the token; pixel: Meta refused the Pixel (wrong ID or no permission)"
        kind: String!
        "Meta's own message"
        message: String!
        at: DateTime!
    }

    type BdMetaSetup {
        "MetaSettings from @ecommbd/shared"
        settings: JSON!
        pixels: [BdMetaPixel!]!
        "Pixels whose events are held: nothing is sent for them until a new token is saved"
        holds: [BdMetaPixelHold!]!
        keyringConfigured: Boolean!
        graphVersion: String!
    }

    type BdUpdateMetaSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdMetaTestResult {
        ok: Boolean!
        "Why it didn't work: noToken, noTestCode (a test event needs one) or refused (Meta's message)"
        code: String
        "Meta's own message"
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
        "Meta's answer to the request that carried it: events_received (of batch_size), fbtrace_id, messages"
        response: JSON
        "Meta's message, or ours: tooOld (over Meta's 7 days), backlog (dropped from a large backlog)"
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
        "Newest first. order: an order code or number"
        bdMetaEvents(eventName: String, status: String, order: String, skip: Int, take: Int): BdMetaEventList!
    }

    extend type Mutation {
        updateBdMetaSettings(input: JSON!): BdUpdateMetaSettingsResult!
        "The Conversions API token for a Pixel; never sent back"
        saveBdMetaToken(pixelId: String!, token: String!): [BdSettingsFieldError!]!
        sendBdMetaTestEvent(pixelId: String!): BdMetaTestResult!
    }
`;

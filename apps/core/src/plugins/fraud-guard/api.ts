import gql from 'graphql-tag';

/** Shop API: saving checkout progress (never read back) and verification codes for COD. */
export const fraudShopApiExtensions = gql`
    input BdCheckoutProgressInput {
        "Any common form of a Bangladeshi mobile number; saved only when valid"
        phone: String!
        name: String
        districtId: String
        thanaId: String
        "utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ref"
        source: JSON
        "The hidden bot-check field of the checkout form; leave empty"
        website: String
    }

    type BdOtpResult {
        success: Boolean!
        "NO_ACTIVE_ORDER, NOT_NEEDED, COOLDOWN, DAILY_LIMIT, NO_CODE, EXPIRED, WRONG_CODE, TOO_MANY_ATTEMPTS or NOT_ALLOWED"
        errorCode: String
        "In the request's language"
        message: String
        "With COOLDOWN, and after sending: when a new code may be asked for"
        retryAfterSeconds: Int
        "With WRONG_CODE"
        attemptsLeft: Int
    }

    extend type Mutation {
        "Saves the checkout as the shopper types (debounced), for staff to follow up if they leave. Always true."
        saveCheckoutProgress(input: BdCheckoutProgressInput!): Boolean!
        "Sends a 6-digit code by SMS to the active order's phone, when COD needs one (bdPaymentOptions.codOtpRequired)"
        sendBdOtp: BdOtpResult!
        verifyBdOtp(code: String!): BdOtpResult!
        "No code arrived: order anyway, marked not verified (only when the store allows it, a minute after a code was sent)"
        skipBdOtp: BdOtpResult!
    }
`;

/** Admin API: incomplete orders, the block list, the risk badge and the settings. */
export const fraudAdminApiExtensions = gql`
    type BdCartSnapshotLine {
        variantId: ID!
        name: String!
        quantity: Int!
        unitPrice: Money!
    }

    type BdIncompleteCheckout {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        "open, recovered, converted, dismissed or expired"
        status: String!
        "Null once expired"
        phone: String
        name: String
        districtId: String
        thanaId: String
        cart: [BdCartSnapshotLine!]
        cartTotal: Money!
        source: JSON
        language: String!
        orderId: ID
        orderNumber: String
        dismissReason: String
        closedBy: String
        closedAt: DateTime
        smsSentAt: DateTime
    }

    type BdIncompleteCheckoutList {
        items: [BdIncompleteCheckout!]!
        totalItems: Int!
    }

    type BdIncompleteCheckoutCounts {
        open: Int!
        recovered: Int!
        converted: Int!
        dismissed: Int!
        expired: Int!
    }

    type BdBlockEntry {
        id: ID!
        createdAt: DateTime!
        "phone or ip"
        kind: String!
        value: String!
        "Null: permanent (phones only)"
        expiresAt: DateTime
        note: String!
        addedBy: String!
    }

    type BdBlockEntryList {
        items: [BdBlockEntry!]!
        totalItems: Int!
    }

    input BdBlockInput {
        "phone or ip"
        kind: String!
        value: String!
        "Required for IPs, at most 30 days ahead"
        expiresAt: DateTime
        note: String
    }

    type BdBlockResult {
        entry: BdBlockEntry
        "INVALID_PHONE, INVALID_IP, EXPIRY_REQUIRED, EXPIRY_TOO_LONG or EXPIRY_IN_PAST"
        error: String
    }

    type BdRiskReason {
        "fakeBefore, returnsBefore, manyOrders, duplicateCart, shortAddress, unlistedThana, oddName or deliveredBefore"
        code: String!
        count: Int
    }

    type BdOrderRisk {
        "0 to 100"
        score: Int!
        "low, medium or high"
        level: String!
        reasons: [BdRiskReason!]!
    }

    type BdUpdateFraudSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Order {
        "Kept when the order was placed; null without the ReadRisk permission, or for older orders"
        bdRisk: BdOrderRisk
        "COD verification by SMS code: verified, unverified (no code arrived) or null"
        bdOtpStatus: String
    }

    extend type Customer {
        "The active block on this customer's phone, if any"
        bdBlock: BdBlockEntry
    }

    extend type Query {
        "Newest first. search: digits of the phone"
        bdIncompleteCheckouts(status: String, search: String, skip: Int, take: Int): BdIncompleteCheckoutList!
        bdIncompleteCheckout(id: ID!): BdIncompleteCheckout
        bdIncompleteCheckoutCounts: BdIncompleteCheckoutCounts!
        "Active entries, newest first. search: part of a phone number or IP"
        bdBlockList(kind: String, search: String, skip: Int, take: Int): BdBlockEntryList!
        "FraudSettings from @ecommbd/shared"
        bdFraudSettings: JSON!
    }

    extend type Mutation {
        "reason: wrongNumber, notInterested, alreadyOrdered, test or other"
        dismissBdIncompleteCheckout(id: ID!, reason: String!): BdIncompleteCheckout
        "The \\"your order is waiting\\" SMS; sent once per record"
        sendBdIncompleteCheckoutSms(id: ID!): BdIncompleteCheckout
        blockBdContact(input: BdBlockInput!): BdBlockResult!
        unblockBdContact(id: ID!, reason: String!): BdBlockEntry
        updateBdFraudSettings(input: JSON!): BdUpdateFraudSettingsResult!
    }
`;

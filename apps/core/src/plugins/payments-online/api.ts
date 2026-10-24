import gql from 'graphql-tag';

export const onlineShopApiExtensions = gql`
    type BdOnlinePaymentOption {
        "sslcommerz or bkash"
        gateway: String!
        "The payment method code for addPaymentToOrder (metadata: { purpose: full | advance })"
        methodCode: String!
        "sandbox or live: in sandbox no real money moves"
        mode: String!
    }

    extend type BdPaymentOptions {
        "Gateways the order can be paid with now (on, set up, not paused after failures)"
        online: [BdOnlinePaymentOption!]!
    }

    type BdTrackedOnlinePayment {
        gateway: String!
        "advance or full"
        purpose: String!
        amount: Money!
        "When the order is cancelled if still unpaid"
        expiresAt: DateTime!
        "Why the last try failed, e.g. insufficientBalance, unavailable"
        lastFailure: String
    }

    extend type BdTrackedOrder {
        "Set while the order waits for its online payment: show 'Pay now' (POST /bd-pay/again/<token>)"
        onlinePayment: BdTrackedOnlinePayment
    }
`;

export const onlineAdminApiExtensions = gql`
    extend enum HistoryEntryType {
        BD_ONLINE_PAYMENT
    }

    type BdGatewayCredentialField {
        name: String!
        saved: Boolean!
        "Only for non-secret fields (store ID, username)"
        value: String
    }

    type BdGatewayCredentials {
        gateway: String!
        mode: String!
        complete: Boolean!
        fields: [BdGatewayCredentialField!]!
    }

    type BdGatewayHealth {
        gateway: String!
        "Failed repeatedly and hidden at checkout for a few minutes"
        paused: Boolean!
    }

    type BdOnlinePaymentSetup {
        "OnlinePaymentSettings from @ecommbd/shared"
        settings: JSON!
        credentials: [BdGatewayCredentials!]!
        health: [BdGatewayHealth!]!
        "SECRETS_KEYRING is set: credentials can be saved"
        keyringConfigured: Boolean!
        "STOREFRONT_URL is set: gateways can send shoppers back"
        publicUrlConfigured: Boolean!
        "Where SSLCommerz sends payment notifications (set it in the SSLCommerz panel too)"
        ipnUrl: String
    }

    type BdUpdateOnlinePaymentSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdSaveGatewayCredentialsResult {
        credentials: BdGatewayCredentials
        errors: [BdSettingsFieldError!]!
    }

    type BdGatewayTestResult {
        ok: Boolean!
        message: String
    }

    type BdPaymentAttemptEvent {
        at: DateTime!
        source: String!
        status: String!
    }

    type BdPaymentAttempt {
        id: ID!
        createdAt: DateTime!
        orderId: ID!
        paymentId: ID!
        gateway: String!
        mode: String!
        amount: Money!
        "created, started, paid, failed, cancelled or expired"
        status: String!
        "What to search for in the gateway's panel"
        gatewayTransactionId: String
        paidAmount: Money
        paidAt: DateTime
        failureCode: String
        lastCheckedAt: DateTime
        nextCheckAt: DateTime
        "late, duplicate, risky or mismatch"
        reviewReason: String
        "open, accepted, refunded or resolved"
        reviewState: String
        reviewNote: String
        reviewedBy: String
        reviewedAt: DateTime
        refundReference: String
        events: [BdPaymentAttemptEvent!]!
        orderCode: String
        orderNumber: String
    }

    "An online payment action was refused. message is in the request's language."
    type BdOnlinePaymentError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        "NOT_FOUND, NOT_OPEN, NOT_RISKY, NOTE_REQUIRED, REFUND_FAILED or UNAVAILABLE"
        reason: String!
        "The gateway's own words, for REFUND_FAILED"
        detail: String
    }

    union BdPaymentReviewResult = BdPaymentAttempt | BdOnlinePaymentError

    extend type Query {
        bdOnlinePaymentSetup: BdOnlinePaymentSetup!
        "Every try at paying the order online, oldest first"
        bdPaymentAttempts(orderId: ID!): [BdPaymentAttempt!]!
        "Online payments held for staff: late, duplicate, risky or with the wrong amount"
        bdPaymentReviews: [BdPaymentAttempt!]!
    }

    extend type Mutation {
        updateBdOnlinePaymentSettings(input: JSON!): BdUpdateOnlinePaymentSettingsResult!
        "Empty fields keep what's saved. Secrets are never sent back."
        saveBdGatewayCredentials(
            gateway: String!
            mode: String!
            input: JSON!
        ): BdSaveGatewayCredentialsResult!
        testBdGatewayConnection(gateway: String!, mode: String!): BdGatewayTestResult!
        "Ask the gateway now what happened to this attempt"
        checkBdPaymentAttempt(id: ID!): BdPaymentAttempt
        "accept (risky only), refund (through the gateway) or resolve (handled outside; needs a note)"
        reviewBdPayment(id: ID!, action: String!, note: String): BdPaymentReviewResult!
    }
`;

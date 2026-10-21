import gql from 'graphql-tag';

/** Admin API for printing (roadmap phase 06). Documents: invoice, slip, receipt, sticker. */
export const printAdminApiExtensions = gql`
    type BdPrintText {
        bn: String!
        en: String!
    }

    type BdPrintLine {
        name: String!
        sku: String!
        quantity: Int!
        "Null on packing slips"
        unitPrice: Money
        linePrice: Money
    }

    type BdPrintOrder {
        id: ID!
        code: String!
        orderNumber: String!
        placedAt: DateTime
        customerName: String!
        phone: String
        alternatePhone: String
        streetLine1: String!
        area: String
        districtId: String
        thanaId: String
        landmark: String
        note: String
        lines: [BdPrintLine!]!
        "Money is null on packing slips"
        subtotal: Money
        discount: Money
        delivery: Money
        total: Money
        paid: Money
        "What the courier collects"
        codDue: Money
        "cod, advance or prepaid"
        paymentType: String!
        paymentMethods: [String!]!
        "When this document was last printed for the order; null the first time"
        printedAt: DateTime
        "The courier's consignment ID (from phase 19)"
        courierConsignment: String
    }

    type BdPrintStore {
        name: BdPrintText!
        "E.164"
        phones: [String!]!
        addressLine: String!
        area: String!
        districtId: String!
        thanaId: String!
        logo: Asset
        "The first paragraph of the return policy"
        returnPolicy: BdPrintText!
    }

    type BdPrintData {
        document: String!
        "In the order asked for; only placed orders"
        orders: [BdPrintOrder!]!
        store: BdPrintStore!
        "PrintSettings from @ecommbd/shared"
        settings: JSON!
    }

    type BdOrderPrintInfo {
        "Invoice or thermal receipt"
        invoicePrintedAt: DateTime
        slipPrintedAt: DateTime
        stickerPrintedAt: DateTime
    }

    extend type Order {
        bdPrint: BdOrderPrintInfo!
    }

    type BdUpdatePrintSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        "Needs PrintOrders. 1 to 100 orders: print bigger selections in batches."
        bdPrintData(orderIds: [ID!]!, document: String!): BdPrintData!
        "PrintSettings from @ecommbd/shared"
        bdPrintSettings: JSON!
    }

    extend type Mutation {
        "Records that a document was printed, so later prints say Reprint. Returns how many orders."
        markBdOrdersPrinted(orderIds: [ID!]!, document: String!): Int!
        "Needs the UpdateStoreSettings permission."
        updateBdPrintSettings(input: JSON!): BdUpdatePrintSettingsResult!
    }
`;

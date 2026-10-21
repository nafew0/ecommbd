import { MANUAL_ORDER_ERROR_CODES } from '@ecommbd/shared';
import gql from 'graphql-tag';

/** Admin API for manual orders and order edits (roadmap phase 05). Amounts are poisha. */
export const manualOrdersAdminApiExtensions = gql`
    extend enum HistoryEntryType {
        BD_ORDER_EDIT
    }

    enum BdManualOrderErrorCode {
        ${MANUAL_ORDER_ERROR_CODES.join('\n')}
    }

    "A manual order or edit was refused. message is in the request's language."
    type BdManualOrderError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        reason: BdManualOrderErrorCode!
        "Products short of stock, the address problem, or the payment's own message"
        details: [String!]!
    }

    union BdManualOrderResult = Order | BdManualOrderError

    input BdManualCustomerInput {
        name: String!
        phone: String!
        alternatePhone: String
    }

    input BdManualAddressInput {
        districtId: String!
        thanaId: String!
        area: String
        streetLine1: String!
        landmark: String
    }

    input BdManualLineInput {
        variantId: ID!
        quantity: Int!
        "A price staff set (OverridePrice)"
        unitPrice: Money
    }

    input BdManualPaymentInput {
        "cod, paid or advance"
        type: String!
        "bkash, nagad, rocket, cash or bank (paid and advance)"
        method: String
        transactionId: String
        "The advance received (advance)"
        amount: Money
    }

    input BdManualOrderInput {
        customer: BdManualCustomerInput!
        address: BdManualAddressInput!
        saveAddress: Boolean
        lines: [BdManualLineInput!]!
        discount: Money
        deliveryCharge: Money
        shippingMethodId: ID
        payment: BdManualPaymentInput!
        "messenger, facebookComment, phone, whatsapp, walkIn or other"
        source: String!
        note: String
        sendSms: Boolean
        confirm: Boolean
    }

    type BdDeliveryOption {
        id: ID!
        name: String!
        price: Money!
    }

    type BdManualOrderQuote {
        subTotal: Money!
        delivery: Money!
        discount: Money!
        codFee: Money!
        total: Money!
        paidNow: Money!
        codDue: Money!
        deliveryOptions: [BdDeliveryOption!]!
        shippingMethodId: ID
    }

    union BdManualOrderQuoteResult = BdManualOrderQuote | BdManualOrderError

    input BdEditLineInput {
        "An existing line (quantity 0 removes it)"
        orderLineId: ID
        "A new product"
        variantId: ID
        quantity: Int!
        unitPrice: Money
    }

    input BdEditOrderInput {
        orderId: ID!
        expectedStatus: String
        "Every line the order should have; lines left out are removed"
        lines: [BdEditLineInput!]!
        address: BdManualAddressInput
        "Leave out to keep; null for the delivery rules"
        deliveryCharge: Money
        "Leave out to keep; 0 for no discount"
        discount: Money
        note: String
    }

    extend type Query {
        "What a manual order will cost (nothing is saved)"
        bdManualOrderQuote(input: BdManualOrderInput!): BdManualOrderQuoteResult!
    }

    extend type Mutation {
        createBdManualOrder(input: BdManualOrderInput!): BdManualOrderResult!
        editBdOrder(input: BdEditOrderInput!): BdManualOrderResult!
    }
`;

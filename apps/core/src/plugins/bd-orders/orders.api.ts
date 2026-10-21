import gql from 'graphql-tag';
import { ORDER_ACTION_ERROR_CODES } from './errors';

/** Admin API for the BD order workflow (roadmap phase 04). Status values are those of @ecommbd/shared. */
export const ordersAdminApiExtensions = gql`
    extend enum HistoryEntryType {
        BD_CALL_ATTEMPT
    }

    type BdOrderClaim {
        name: String
        until: DateTime!
        "Claimed by the person asking"
        mine: Boolean!
    }

    type BdOrderInfo {
        "new, confirmed, packed, shipped, partiallyDelivered, delivered, returned or cancelled; null for carts and drafts"
        status: String
        "cod, advance or prepaid"
        paymentType: String!
        "Money received (settled payments)"
        paidAmount: Money!
        "What is still to be collected on delivery"
        codDue: Money!
        cancelReason: String
        cancelNote: String
        "Unanswered calls"
        callAttempts: Int!
        lastCallAt: DateTime
        "The order's place in the confirmation queue; null outside it, in the future when snoozed"
        queueAt: DateTime
        "Someone is calling the customer (claims last 5 minutes)"
        claim: BdOrderClaim
        "Order number of an earlier order from this customer with the same items, within 30 minutes"
        possibleDuplicateOf: String
        "The store's auto-cancel rule says this order looks unreachable"
        suggestCancel: Boolean!
        imported: Boolean!
    }

    extend type Order {
        bd: BdOrderInfo!
    }

    type BdOrderStatusCount {
        status: String!
        count: Int!
    }

    type BdOrderStats {
        "00:00 Dhaka time of the day shown"
        dayStart: DateTime!
        todayOrders: Int!
        "Value of orders placed during this Dhaka day, including delivery charges, excluding cancelled orders. Includes undelivered and returned orders; not money received. Null without ReadSalesFigures."
        todayOrderValue: Money
        "Compatibility alias for todayOrderValue, with the same permission check"
        todaySales: Money @deprecated(reason: "Use todayOrderValue. This is placed order value, not money received.")
        waitingConfirmation: Int!
        confirmedNotPacked: Int!
    }

    enum BdOrderActionErrorCode {
        ${ORDER_ACTION_ERROR_CODES.join('\n')}
    }

    "An order action was refused. message is in the request's language (?languageCode=bn)."
    type BdOrderActionError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        reason: BdOrderActionErrorCode!
        "The order's status now"
        currentStatus: String
        "Who made the last status change, and when"
        changedBy: String
        changedAt: DateTime
        "Products short of stock, or Vendure's reason"
        details: [String!]!
    }

    union BdOrderActionResult = Order | BdOrderActionError

    input BdOrderActionInput {
        orderId: ID!
        "The status the staff member saw; if the order has moved on, nothing is done"
        expectedStatus: String
    }

    input BdConfirmOrderInput {
        orderId: ID!
        expectedStatus: String
        "Confirm although some items are short of stock"
        ignoreStockWarning: Boolean
    }

    input BdCancelOrderInput {
        orderId: ID!
        expectedStatus: String
        "fake, customerCancelled, unreachable, duplicate, outOfStock, priceIssue or other"
        reason: String!
        "Required with other"
        note: String
    }

    input BdReturnOrderInput {
        orderId: ID!
        expectedStatus: String
        note: String
    }

    input BdCallAttemptInput {
        orderId: ID!
        "noAnswer or callLater"
        outcome: String!
        "With callLater"
        callBackAt: DateTime
        note: String
    }

    type BdUpdateOrderSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        "Placed orders, newest first. Dates are Dhaka days (YYYY-MM-DD). search: phone digits, an order number or a name."
        bdOrders(
            status: String
            search: String
            dateFrom: String
            dateTo: String
            districtId: String
            paymentType: String
            skip: Int
            take: Int
        ): OrderList!
        "Orders per status, with the same filters"
        bdOrderCounts(
            search: String
            dateFrom: String
            dateTo: String
            districtId: String
            paymentType: String
        ): [BdOrderStatusCount!]!
        "New orders to call, oldest first; snoozed: only those set to call later"
        bdConfirmationQueue(snoozed: Boolean, skip: Int, take: Int): OrderList!
        "Home widgets for a Dhaka day (YYYY-MM-DD, default today)"
        bdOrderStats(date: String): BdOrderStats!
        "OrderSettings from @ecommbd/shared"
        bdOrderSettings: JSON!
    }

    extend type Mutation {
        confirmBdOrder(input: BdConfirmOrderInput!): BdOrderActionResult!
        "Confirms orders staff have already checked, each on its own"
        confirmBdOrders(orderIds: [ID!]!): [BdOrderActionResult!]!
        cancelBdOrder(input: BdCancelOrderInput!): BdOrderActionResult!
        packBdOrder(input: BdOrderActionInput!): BdOrderActionResult!
        markBdOrderShipped(input: BdOrderActionInput!): BdOrderActionResult!
        markBdOrderDelivered(input: BdOrderActionInput!): BdOrderActionResult!
        "Records delivery status only; does not record per-line returned quantities, restock items or issue refunds."
        markBdOrderReturned(input: BdReturnOrderInput!): BdOrderActionResult!
        recordBdCallAttempt(input: BdCallAttemptInput!): BdOrderActionResult!
        "Opening a New order claims it for 5 minutes"
        claimBdOrder(orderId: ID!): BdOrderActionResult!
        releaseBdOrderClaim(orderId: ID!): Boolean!
        "Needs the UpdateStoreSettings permission."
        updateBdOrderSettings(input: JSON!): BdUpdateOrderSettingsResult!
    }
`;

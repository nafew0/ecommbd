import gql from 'graphql-tag';
import { PAYMENT_ERROR_CODES } from './payment-checks.service';

export const paymentsShopApiExtensions = gql`
    type BdMfsAccount {
        "bkash, nagad or rocket"
        provider: String!
        "The payment method code for addPaymentToOrder"
        methodCode: String!
        "The merchant's number, to send the money to"
        number: String!
        "personal (Send Money), merchant (Payment) or agent (Cash Out)"
        accountType: String!
    }

    type BdPaymentOptions {
        codAvailable: Boolean!
        "COD_OFF, COD_OVER_LIMIT, COD_NOT_HERE or COD_UNAVAILABLE"
        codUnavailableReason: String
        codUnavailableMessage: String
        "Paid first by mobile banking (purpose advance) when paying by COD; 0 when none is needed"
        advanceAmount: Money!
        "Collected on delivery with COD, after the advance"
        codAmount: Money!
        "The COD charge included in codAmount"
        codFee: Money!
        mfs: [BdMfsAccount!]!
    }

    extend type Query {
        "How the active order can be paid; null without an active order"
        bdPaymentOptions: BdPaymentOptions
    }

    extend type Mutation {
        "cod or prepaid: puts the right COD charge on the active order. Call it before paying."
        setBdPaymentChoice(choice: String!): Order
    }
`;

export const paymentsAdminApiExtensions = gql`
    extend enum HistoryEntryType {
        BD_PAYMENT_CHECK
    }

    enum BdPaymentErrorCode {
        ${PAYMENT_ERROR_CODES.join('\n')}
    }

    "A payment action was refused. message is in the request's language."
    type BdPaymentError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        reason: BdPaymentErrorCode!
    }

    union BdPaymentCheckResult = Payment | BdPaymentError
    union BdRefundResult = Refund | BdPaymentError

    type BdPaymentToVerify {
        paymentId: ID!
        orderId: ID!
        orderCode: String!
        orderNumber: String
        customerName: String!
        customerPhone: String!
        orderTotal: Money!
        provider: String!
        senderNumber: String!
        transactionId: String!
        "Characters easy to misread (O/0, I/1, S/5, B/8): check them on the statement"
        lookalikes: [String!]!
        "advance or full"
        purpose: String!
        "What the shopper should have sent"
        amount: Money!
        createdAt: DateTime!
        "Waiting longer than the store's reminder time"
        overdue: Boolean!
    }

    input BdVerifyPaymentInput {
        paymentId: ID!
        "What the statement shows; default: the expected amount"
        receivedAmount: Money
    }

    input BdRejectPaymentInput {
        paymentId: ID!
        "notReceived, wrongAmount, wrongNumber, duplicate or other (other needs a note)"
        reason: String!
        note: String
    }

    input BdRecordRefundInput {
        paymentId: ID!
        amount: Money!
        "bkash, nagad, rocket, cash or bank"
        method: String!
        transactionId: String
        note: String
    }

    input BdSettleRefundInput {
        "A refund due (pending), e.g. after an order edit lowered the total"
        refundId: ID!
        method: String!
        transactionId: String
        note: String
    }

    type BdUpdatePaymentSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        bdPaymentSettings: JSON!
        "Mobile banking payments waiting for staff, oldest first"
        bdPaymentsToVerify: [BdPaymentToVerify!]!
    }

    extend type Mutation {
        updateBdPaymentSettings(input: JSON!): BdUpdatePaymentSettingsResult!
        verifyBdPayment(input: BdVerifyPaymentInput!): BdPaymentCheckResult!
        rejectBdPayment(input: BdRejectPaymentInput!): BdPaymentCheckResult!
        recordBdRefund(input: BdRecordRefundInput!): BdRefundResult!
        settleBdRefund(input: BdSettleRefundInput!): BdRefundResult!
    }
`;

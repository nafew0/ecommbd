import gql from 'graphql-tag';

/** Admin API for suppliers and purchases (phase 52). Cost is on every line, so ReadCost is required too. */
export const purchaseAdminApiExtensions = gql`
    type BdSupplierRow {
        id: ID!
        name: String!
        phone: String
        balance: Int!
        purchaseCount: Int!
    }

    type BdSupplierList {
        totalItems: Int!
        items: [BdSupplierRow!]!
    }

    type BdSupplierPaymentRow {
        id: ID!
        amount: Int!
        paidOn: String!
        note: String!
    }

    type BdPurchaseRow {
        id: ID!
        number: String!
        supplierId: ID!
        supplierName: String!
        purchasedOn: String!
        status: String!
        total: Int!
        owed: Int!
    }

    type BdSupplierDetail {
        id: ID!
        name: String!
        phone: String
        address: String!
        note: String!
        balance: Int!
        purchases: [BdPurchaseRow!]!
        payments: [BdSupplierPaymentRow!]!
    }

    type BdFieldError {
        path: String!
        code: String!
    }

    type BdSupplierResult {
        supplier: BdSupplierDetail
        errors: [BdFieldError!]!
    }

    type BdPurchaseList {
        totalItems: Int!
        items: [BdPurchaseRow!]!
    }

    type BdPurchaseLineView {
        id: ID!
        variantId: ID!
        name: String!
        sku: String!
        quantity: Int!
        received: Int!
        returned: Int!
        unitCost: Int!
    }

    type BdPurchaseReturnLineView {
        purchaseLineId: ID!
        quantity: Int!
        unitCost: Int!
    }

    type BdPurchaseReturnView {
        id: ID!
        number: String!
        returnedOn: String!
        note: String!
        lines: [BdPurchaseReturnLineView!]!
    }

    type BdPurchaseDetail {
        id: ID!
        number: String!
        supplierId: ID!
        supplierName: String!
        supplierPhone: String
        supplierAddress: String!
        purchasedOn: String!
        status: String!
        note: String!
        receiveNote: String!
        delivery: Int!
        other: Int!
        discount: Int!
        paid: Int!
        billAssetId: ID
        billPreview: String
        total: Int!
        owed: Int!
        lines: [BdPurchaseLineView!]!
        returns: [BdPurchaseReturnView!]!
        "Where the goods arrive. Null means the original location."
        branchId: ID
        branchName: String!
    }

    type BdPurchaseResult {
        purchase: BdPurchaseDetail
        errors: [BdFieldError!]!
    }

    extend type Query {
        bdSuppliers(search: String, skip: Int, take: Int): BdSupplierList!
        bdSupplier(id: ID!): BdSupplierDetail
        bdPurchases(search: String, status: String, supplierId: ID, skip: Int, take: Int): BdPurchaseList!
        bdPurchase(id: ID!): BdPurchaseDetail
        bdPurchaseSettings: JSON!
        bdPurchasePrint(id: ID!, document: String!): JSON!
    }

    extend type Mutation {
        createBdSupplier(input: JSON!): BdSupplierResult!
        updateBdSupplier(id: ID!, input: JSON!): BdSupplierResult!
        createBdPurchase(input: JSON!): BdPurchaseResult!
        updateBdPurchase(id: ID!, input: JSON!): BdPurchaseResult!
        deleteBdPurchase(id: ID!): Boolean!
        markBdPurchaseOrdered(id: ID!): BdPurchaseDetail!
        receiveBdPurchase(id: ID!, input: JSON!): BdPurchaseDetail!
        returnBdPurchase(id: ID!, input: JSON!): BdPurchaseDetail!
        recordBdSupplierPayment(input: JSON!): BdSupplierDetail!
        updateBdPurchaseSettings(input: JSON!): JSON!
    }
`;

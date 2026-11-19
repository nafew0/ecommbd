import gql from 'graphql-tag';

/** Admin API for branches and stock transfers (phase 54). */
export const branchAdminApiExtensions = gql`
    type BdBranch {
        id: ID!
        name: String!
        phone: String
        districtId: String!
        thanaId: String!
        districtName: String!
        thanaName: String!
        addressLine: String!
        note: String!
        sellsOnline: Boolean!
    }

    type BdBranchResult {
        branch: BdBranch
        errors: [BdFieldError!]!
    }

    type BdBranchUsage {
        count: Int!
    }

    type BdBranchSettingsResult {
        settings: JSON
        errors: [BdFieldError!]!
    }

    type BdOrderBranch {
        branchId: ID
        name: String!
        transferNeeded: Boolean!
    }

    type BdBranchStock {
        branchId: ID!
        name: String!
        sellsOnline: Boolean!
        stockOnHand: Int!
    }

    type BdVariantBranchStock {
        variantId: ID!
        branches: [BdBranchStock!]!
    }

    type BdTransferLine {
        id: ID!
        variantId: ID!
        name: String!
        sku: String!
        quantity: Int!
        received: Int!
        inTransit: Int!
    }

    type BdTransfer {
        id: ID!
        number: String!
        fromId: ID!
        toId: ID!
        fromName: String!
        toName: String!
        status: String!
        note: String!
        sentAt: DateTime!
        lines: [BdTransferLine!]!
    }

    type BdTransferResult {
        transfer: BdTransfer
        errors: [BdFieldError!]!
    }

    extend type Query {
        bdBranches: [BdBranch!]!
        bdBranch(id: ID!): BdBranch
        bdBranchUsage: BdBranchUsage!
        bdBranchSettings: JSON!
        bdTransfers: [BdTransfer!]!
        bdTransfer(id: ID!): BdTransfer
        bdOrderBranch(orderId: ID!): BdOrderBranch
        bdProductBranchStock(productId: ID!): [BdVariantBranchStock!]!
    }

    extend type Mutation {
        saveBdBranch(id: ID, input: JSON!): BdBranchResult!
        deleteBdBranch(id: ID!): Boolean!
        updateBdBranchSettings(input: JSON!): BdBranchSettingsResult!
        sendBdTransfer(input: JSON!): BdTransferResult!
        receiveBdTransfer(id: ID!, input: JSON!): BdTransfer!
    }
`;

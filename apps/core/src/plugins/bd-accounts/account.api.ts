import gql from 'graphql-tag';

/** Admin API for accounts, expenses and profit and loss (phase 53). Every field needs ManageAccounts. */
export const accountAdminApiExtensions = gql`
    type BdAccount {
        id: ID!
        kind: String!
        name: String!
        openingBalance: Int!
        balance: Int!
    }

    type BdAccountList {
        totalItems: Int!
        items: [BdAccount!]!
    }

    type BdAccountFieldError {
        path: String!
        code: String!
    }

    type BdAccountSaveResult {
        account: BdAccount
        errors: [BdAccountFieldError!]!
    }

    type BdTransaction {
        id: ID!
        accountId: ID!
        accountName: String!
        direction: String!
        amount: Int!
        date: String!
        source: String!
        sourceId: String
        note: String!
        transferId: String
    }

    type BdTransactionList {
        totalItems: Int!
        items: [BdTransaction!]!
    }

    type BdExpenseHead {
        id: ID!
        code: String!
        nameBn: String!
        nameEn: String!
    }

    type BdExpenseHeadSaveResult {
        head: BdExpenseHead
        errors: [BdAccountFieldError!]!
    }

    type BdExpense {
        id: ID!
        date: String!
        headId: ID!
        headCode: String!
        headName: String!
        amount: Int!
        accountId: ID!
        accountName: String!
        note: String!
        receiptAssetId: ID
    }

    type BdExpenseList {
        totalItems: Int!
        items: [BdExpense!]!
    }

    type BdExpenseSaveResult {
        expense: BdExpense
        errors: [BdAccountFieldError!]!
    }

    type BdPlMoney {
        known: Boolean!
        amount: Int
    }

    type BdProfitHead {
        code: String!
        name: String!
        amount: Int!
    }

    type BdProfitDay {
        date: String!
        sales: Int
        profit: Int
    }

    type BdProfitNote {
        orderCode: String!
        saleDate: String!
        returnDate: String!
    }

    type BdProfitAndLoss {
        dateFrom: String!
        dateTo: String!
        previousFrom: String!
        previousTo: String!
        sales: BdPlMoney!
        productCost: BdPlMoney!
        deliveryAndCod: BdPlMoney!
        gatewayFees: BdPlMoney!
        expensesByHead: [BdProfitHead!]!
        expenseTotal: Int!
        profit: BdPlMoney!
        previousProfit: BdPlMoney!
        days: [BdProfitDay!]!
        notes: [BdProfitNote!]!
    }

    type BdAccountSettings {
        codAccountId: String
        gatewayAccountId: String
        bkashAccountId: String
        nagadAccountId: String
        rocketAccountId: String
    }

    type BdAccountSettingsResult {
        settings: BdAccountSettings
        errors: [BdAccountFieldError!]!
    }

    extend type Query {
        bdAccounts(search: String, skip: Int, take: Int): BdAccountList!
        bdAccount(id: ID!): BdAccount
        bdTransactions(accountId: ID, source: String, dateFrom: String, dateTo: String, skip: Int, take: Int): BdTransactionList!
        bdTransactionsCsv(accountId: ID, source: String, dateFrom: String, dateTo: String): String!
        bdExpenseHeads: [BdExpenseHead!]!
        bdExpenses(headId: ID, dateFrom: String, dateTo: String, skip: Int, take: Int): BdExpenseList!
        bdExpense(id: ID!): BdExpense
        bdProfitAndLoss(dateFrom: String!, dateTo: String!): BdProfitAndLoss!
        bdAccountSettings: BdAccountSettings!
    }

    extend type Mutation {
        saveBdAccount(id: ID, input: JSON!): BdAccountSaveResult!
        saveBdExpense(id: ID, input: JSON!): BdExpenseSaveResult!
        saveBdExpenseHead(id: ID, input: JSON!): BdExpenseHeadSaveResult!
        transferBdMoney(input: JSON!): [BdTransaction!]!
        recordBdManualEntry(input: JSON!): BdTransaction!
        updateBdAccountSettings(input: JSON!): BdAccountSettingsResult!
    }
`;

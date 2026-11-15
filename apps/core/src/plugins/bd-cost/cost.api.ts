import gql from 'graphql-tag';

/** Admin API for cost and profit (roadmap phase 51). Every field here requires ReadCost. */
export const costAdminApiExtensions = gql`
    type BdMoneyPart {
        "Null when this part is unknown. A known zero is 0, never a stand-in for missing."
        amount: Money
        known: Boolean!
        "order, costSnapshot, courier, storeSetting, notBooked, prepaid, noGateway or notCollected"
        source: String!
        "The courier's code or the name staff typed, when the source is the courier"
        detail: String
    }

    type BdOrderProfitLine {
        orderLineId: ID!
        name: String!
        "Null when a partial delivery never recorded how many came back"
        deliveredQuantity: Int
        unitCost: Money
        belowCost: Boolean!
    }

    type BdOrderProfit {
        orderId: ID!
        sellingPrice: BdMoneyPart!
        discount: BdMoneyPart!
        deliveryCharged: BdMoneyPart!
        codFeeCharged: BdMoneyPart!
        productCost: BdMoneyPart!
        courierCharge: BdMoneyPart!
        codCharge: BdMoneyPart!
        gatewayFee: BdMoneyPart!
        profit: BdMoneyPart!
        belowCost: Boolean!
        lines: [BdOrderProfitLine!]!
    }

    extend type Query {
        "Profit of one placed order. ReadCost."
        bdOrderProfit(orderId: ID!): BdOrderProfit!
        "Profit of up to 100 placed orders, for the order list. ReadCost."
        bdOrderProfits(orderIds: [ID!]!): [BdOrderProfit!]!
        "What the store pays the courier, for COD collection and to the gateway. ReadCost."
        bdCostSettings: JSON!
    }

    extend type Mutation {
        "Saves cost settings. Needs UpdateStoreSettings and ReadCost."
        updateBdCostSettings(input: JSON!): BdSaveCostSettingsResult!
    }

    type BdSaveCostSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }
`;

import gql from 'graphql-tag';

/** Shop API: order tracking for shoppers (roadmap phase 14), by order number and phone or by token. */
export const trackingShopApiExtensions = gql`
    type BdTrackedOrderLine {
        name: String!
        quantity: Int!
    }

    type BdTrackedStatus {
        "new, confirmed, packed, shipped, partiallyDelivered, delivered, returned or cancelled"
        status: String!
        at: DateTime!
    }

    "What a shopper may see of an order: no address, no phone, only the first name and district"
    type BdTrackedOrder {
        orderNumber: String!
        placedAt: DateTime!
        status: String!
        timeline: [BdTrackedStatus!]!
        firstName: String!
        "In the request's language"
        district: String!
        lines: [BdTrackedOrderLine!]!
        total: Money!
        "Still to be paid on delivery"
        codDue: Money!
        "The courier's own tracking page, once the parcel is booked (phase 19)"
        courierTrackingUrl: String
    }

    extend type Query {
        "Both must match; any miss is null. Rate-limited per address and per phone."
        bdTrackOrder(orderNumber: String!, phone: String!): BdTrackedOrder
        "The link in the shipped SMS (/t/<token>)"
        bdTrackOrderByToken(token: String!): BdTrackedOrder
    }

    extend type Order {
        "The order's tracking link key, once placed (for the thank-you page)"
        bdTrackingToken: String
    }
`;

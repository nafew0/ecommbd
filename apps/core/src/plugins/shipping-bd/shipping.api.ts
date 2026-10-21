import gql from 'graphql-tag';

/** `Order.bdDelivery`, in both APIs: the storefront's cart and the manual order screen use it. */
const deliveryInfo = gql`
    type BdDeliveryInfo {
        "dhaka_city, dhaka_suburb, chattogram_city or outside_dhaka; null until the address has a district (and, in Dhaka district, a thana)"
        zone: String
        "Why no delivery method is offered: NO_DISTRICT, NOT_DELIVERED_HERE or TOO_HEAVY; null when one is"
        unavailableReason: String
        "That reason as a sentence in the request's language"
        unavailableMessage: String
        "Free standard delivery from this subtotal; null when the zone has none"
        freeDeliveryThreshold: Money
        "Spend this much more for free delivery (0 once reached); null when the zone has no threshold"
        freeDeliveryRemaining: Money
    }

    extend type Order {
        bdDelivery: BdDeliveryInfo!
    }
`;

export const shippingShopApiExtensions = deliveryInfo;

export const shippingAdminApiExtensions = gql`
    ${deliveryInfo}

    type BdUpdateShippingSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdProductMissingWeight {
        productId: ID!
        variantId: ID!
        name: String!
        sku: String!
    }

    type BdProductsMissingWeight {
        items: [BdProductMissingWeight!]!
        totalItems: Int!
    }

    extend type Query {
        "Delivery charges and rules (amounts in poisha)"
        bdShippingSettings: JSON!
        "Variants without a weight, for the warning shown when weight-based charges are on"
        bdProductsMissingWeight(take: Int): BdProductsMissingWeight!
    }

    extend type Mutation {
        "Needs UpdateShippingMethod"
        updateBdShippingSettings(input: JSON!): BdUpdateShippingSettingsResult!
    }
`;

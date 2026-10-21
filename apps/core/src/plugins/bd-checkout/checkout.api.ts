import gql from 'graphql-tag';
import { CHECKOUT_ERROR_CODES } from './errors';

/** Shop API: phone-first checkout, typed errors, and the checkout settings the storefront needs. */
export const checkoutShopApiExtensions = gql`
    input SetCustomerForOrderByPhoneInput {
        "The full name, as the shopper writes it (Bangla or English)"
        name: String!
        "A Bangladeshi mobile number in any common form; Bangla digits are fine"
        phone: String!
        alternatePhone: String
        "Optional real email"
        email: String
    }

    input SetOrderShippingAddressBDInput {
        "Defaults to the name given with the phone"
        fullName: String
        "From bdDistricts"
        districtId: String!
        "From bdThanas, or other (then area is required)"
        thanaId: String!
        area: String
        "House, road, village"
        streetLine1: String!
        landmark: String
        postalCode: String
        alternatePhone: String
        "The shopper's note for the order"
        note: String
    }

    enum BdCheckoutErrorCode {
        ${CHECKOUT_ERROR_CODES.join('\n')}
    }

    "A checkout input was refused. message is in the request's language (?languageCode=bn)."
    type BdCheckoutError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        "Why the input was refused (named so it doesn't clash with Order.code in the result union)"
        reason: BdCheckoutErrorCode!
        "The input field to highlight"
        field: String
        "With RATE_LIMITED"
        retryAfterSeconds: Int
    }

    union SetCustomerForOrderByPhoneResult = Order | BdCheckoutError
    union SetOrderShippingAddressBDResult = Order | BdCheckoutError

    type BdCheckoutSettings {
        showEmail: Boolean!
        showAlternatePhone: Boolean!
        showNote: Boolean!
        minAddressLength: Int!
        allowInternationalPhones: Boolean!
    }

    extend type Query {
        bdCheckoutSettings: BdCheckoutSettings!
    }

    extend type Mutation {
        "Finds the customer by phone (or creates one) and attaches them to the active order. No email needed."
        setCustomerForOrderByPhone(input: SetCustomerForOrderByPhoneInput!): SetCustomerForOrderByPhoneResult!
        "Sets the delivery address from a district and thana, and the order note."
        setOrderShippingAddressBD(input: SetOrderShippingAddressBDInput!): SetOrderShippingAddressBDResult!
    }
`;

/** Admin API: the customer list searched by phone, and the checkout settings. */
export const checkoutAdminApiExtensions = gql`
    type BdUpdateCheckoutSettingsResult {
        "The saved settings, or null when there are errors"
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        "Newest first. search: phone digits (any part; Bangla digits are fine), a full number, or part of a name or email. (Plain arguments: Vendure replaces an options argument on list queries with its own type.)"
        bdCustomers(search: String, skip: Int, take: Int): CustomerList!
        "CheckoutSettings from @ecommbd/shared"
        bdCheckoutSettings: JSON!
    }

    extend type Mutation {
        "Needs the UpdateStoreSettings permission."
        updateBdCheckoutSettings(input: JSON!): BdUpdateCheckoutSettingsResult!
    }
`;

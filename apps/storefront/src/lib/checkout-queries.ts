import { graphql } from './core';
import { AssetFields } from './queries';

/** Shop API documents for the cart, checkout, thank-you and tracking pages (roadmap phase 14). */

export const CartOrderFields = graphql(
    `
        fragment CartOrderFields on Order @_unmask {
            id
            code
            state
            active
            orderPlacedAt
            totalQuantity
            subTotalWithTax
            shippingWithTax
            totalWithTax
            shippingLines {
                priceWithTax
                shippingMethod {
                    id
                    code
                    name
                }
            }
            surcharges {
                sku
                description
                priceWithTax
            }
            discounts {
                description
                amountWithTax
            }
            lines {
                id
                quantity
                unitPriceWithTax
                linePriceWithTax
                featuredAsset {
                    ...AssetFields
                }
                productVariant {
                    id
                    name
                    stockLevel
                    product {
                        name
                        slug
                    }
                }
            }
            payments {
                id
                method
                amount
                state
                metadata
            }
            customer {
                firstName
                phoneNumber
            }
            shippingAddress {
                fullName
                streetLine1
                phoneNumber
                customFields {
                    districtId
                    thanaId
                    area
                    landmark
                    alternatePhone
                }
            }
            customFields {
                orderNumber
                customerNote
                paymentChoice
            }
            bdDelivery {
                zone
                freeDeliveryThreshold
                freeDeliveryRemaining
            }
        }
    `,
    [AssetFields],
);

export const ACTIVE_ORDER = graphql(
    `
        query ActiveOrder {
            activeOrder {
                ...CartOrderFields
            }
        }
    `,
    [CartOrderFields],
);

export const ADD_TO_CART = graphql(
    `
        mutation AddToCart($variantId: ID!, $quantity: Int!) {
            addItemToOrder(productVariantId: $variantId, quantity: $quantity) {
                __typename
                ... on Order {
                    ...CartOrderFields
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on InsufficientStockError {
                    quantityAvailable
                }
            }
        }
    `,
    [CartOrderFields],
);

export const ADJUST_LINE = graphql(
    `
        mutation AdjustLine($lineId: ID!, $quantity: Int!) {
            adjustOrderLine(orderLineId: $lineId, quantity: $quantity) {
                __typename
                ... on Order {
                    ...CartOrderFields
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on InsufficientStockError {
                    quantityAvailable
                }
            }
        }
    `,
    [CartOrderFields],
);

export const REMOVE_LINE = graphql(
    `
        mutation RemoveLine($lineId: ID!) {
            removeOrderLine(orderLineId: $lineId) {
                __typename
                ... on Order {
                    ...CartOrderFields
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [CartOrderFields],
);

export const CHECKOUT_SETTINGS = graphql(`
    query CheckoutSettings {
        bdCheckoutSettings {
            showEmail
            showAlternatePhone
            showNote
            minAddressLength
        }
    }
`);

export const DISTRICTS = graphql(`
    query Districts($lang: BdGeoLanguage) {
        bdDistricts(lang: $lang) {
            id
            nameBn
            nameEn
        }
    }
`);

export const THANAS = graphql(`
    query Thanas($districtId: String!, $lang: BdGeoLanguage) {
        bdThanas(districtId: $districtId, lang: $lang) {
            id
            nameBn
            nameEn
        }
    }
`);

/** District and thana only, for the live summary: delivery options and COD amounts depend on them. */
export const SET_PARTIAL_ADDRESS = graphql(`
    mutation SetPartialAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            __typename
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const SHIPPING_OPTIONS = graphql(`
    query ShippingOptions {
        eligibleShippingMethods {
            id
            code
            name
            priceWithTax
            metadata
        }
    }
`);

export const PAYMENT_OPTIONS = graphql(`
    query PaymentOptions {
        bdPaymentOptions {
            codAvailable
            codUnavailableMessage
            advanceAmount
            codAmount
            codFee
            codOtpRequired
            mfs {
                provider
                methodCode
                number
                accountType
            }
            online {
                gateway
                methodCode
                mode
            }
        }
        eligiblePaymentMethods {
            code
            isEligible
            eligibilityMessage
        }
    }
`);

export const SET_CUSTOMER = graphql(`
    mutation SetCustomer($input: SetCustomerForOrderByPhoneInput!) {
        setCustomerForOrderByPhone(input: $input) {
            __typename
            ... on BdCheckoutError {
                reason
                field
                message
                retryAfterSeconds
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const SET_ADDRESS = graphql(`
    mutation SetAddress($input: SetOrderShippingAddressBDInput!) {
        setOrderShippingAddressBD(input: $input) {
            __typename
            ... on BdCheckoutError {
                reason
                field
                message
                retryAfterSeconds
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const SET_SHIPPING = graphql(`
    mutation SetShipping($ids: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $ids) {
            __typename
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const SET_PAYMENT_CHOICE = graphql(`
    mutation SetPaymentChoice($choice: String!) {
        setBdPaymentChoice(choice: $choice) {
            id
        }
    }
`);

export const SAVE_PROGRESS = graphql(`
    mutation SaveProgress($input: BdCheckoutProgressInput!) {
        saveCheckoutProgress(input: $input)
    }
`);

/** Sales pages (phase 16): the page's product, pack and add-on in the sales page session. */
export const SET_SALES_ORDER = graphql(
    `
        mutation SetSalesOrder($input: BdSalesOrderInput!) {
            setBdSalesPageOrder(input: $input) {
                errorCode
                quantityAvailable
                order {
                    ...CartOrderFields
                }
            }
        }
    `,
    [CartOrderFields],
);

/** Where the shopper came from (phase 16), copied onto the order before it's placed. */
export const SET_ATTRIBUTION = graphql(`
    mutation SetAttribution($input: BdAttributionInput!) {
        setBdOrderAttribution(input: $input)
    }
`);

export const OtpFields = graphql(`
    fragment OtpFields on BdOtpResult @_unmask {
        success
        errorCode
        message
        retryAfterSeconds
        attemptsLeft
    }
`);

export const SEND_OTP = graphql(
    `
        mutation SendOtp {
            sendBdOtp {
                ...OtpFields
            }
        }
    `,
    [OtpFields],
);

export const VERIFY_OTP = graphql(
    `
        mutation VerifyOtp($code: String!) {
            verifyBdOtp(code: $code) {
                ...OtpFields
            }
        }
    `,
    [OtpFields],
);

export const SKIP_OTP = graphql(
    `
        mutation SkipOtp {
            skipBdOtp {
                ...OtpFields
            }
        }
    `,
    [OtpFields],
);

export const TO_STATE = graphql(`
    mutation ToState($state: String!) {
        transitionOrderToState(state: $state) {
            __typename
            ... on OrderStateTransitionError {
                message
                transitionError
            }
        }
    }
`);

export const ADD_PAYMENT = graphql(
    `
        mutation AddPayment($input: PaymentInput!) {
            addPaymentToOrder(input: $input) {
                __typename
                ... on Order {
                    ...CartOrderFields
                }
                ... on PaymentDeclinedError {
                    paymentErrorMessage
                }
                ... on PaymentFailedError {
                    paymentErrorMessage
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [CartOrderFields],
);

export const ORDER_BY_CODE = graphql(
    `
        query OrderByCode($code: String!) {
            orderByCode(code: $code) {
                ...CartOrderFields
                bdTrackingToken
            }
        }
    `,
    [CartOrderFields],
);

export const TrackedOrderFields = graphql(`
    fragment TrackedOrderFields on BdTrackedOrder @_unmask {
        orderNumber
        placedAt
        status
        timeline {
            status
            at
        }
        firstName
        district
        lines {
            name
            quantity
        }
        total
        codDue
        courierTrackingUrl
        onlinePayment {
            gateway
            purpose
            amount
            expiresAt
            lastFailure
        }
    }
`);

export const TRACK_ORDER = graphql(
    `
        query TrackOrder($orderNumber: String!, $phone: String!) {
            bdTrackOrder(orderNumber: $orderNumber, phone: $phone) {
                ...TrackedOrderFields
            }
        }
    `,
    [TrackedOrderFields],
);

export const TRACK_BY_TOKEN = graphql(
    `
        query TrackByToken($token: String!) {
            bdTrackOrderByToken(token: $token) {
                ...TrackedOrderFields
            }
        }
    `,
    [TrackedOrderFields],
);

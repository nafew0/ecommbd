import { SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';

/**
 * A shopper's phone checkout through the Shop API, for end-to-end tests: add to cart, name and
 * phone, district/thana address, delivery, then the test payment (dummy, authorized: like COD).
 */

export const DHAKA = 'BD3026';
export const MIRPUR = 'BD3026M26';
export const KUSHTIA = 'BD4050';

export const ORDER_FIELDS = gql`
    fragment CheckoutOrder on Order {
        id
        code
        state
        active
        totalWithTax
        customer {
            id
            firstName
            lastName
            emailAddress
            phoneNumber
        }
        shippingAddress {
            fullName
            phoneNumber
            streetLine1
            city
            province
            countryCode
            customFields {
                districtId
                thanaId
                area
                landmark
                alternatePhone
            }
        }
        customFields {
            customerNote
        }
    }
`;

export const ADD_ITEM = gql`
    mutation ($variantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $variantId, quantity: $quantity) {
            ... on Order {
                id
                code
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SET_CUSTOMER = gql`
    mutation ($input: SetCustomerForOrderByPhoneInput!) {
        setCustomerForOrderByPhone(input: $input) {
            ...CheckoutOrder
            ... on BdCheckoutError {
                errorCode
                reason
                field
                message
                retryAfterSeconds
            }
        }
    }
    ${ORDER_FIELDS}
`;

export const SET_ADDRESS = gql`
    mutation ($input: SetOrderShippingAddressBDInput!) {
        setOrderShippingAddressBD(input: $input) {
            ...CheckoutOrder
            ... on BdCheckoutError {
                errorCode
                reason
                field
                message
            }
        }
    }
    ${ORDER_FIELDS}
`;

const SHIPPING_METHODS = gql`
    query {
        eligibleShippingMethods {
            id
        }
    }
`;

const SET_SHIPPING = gql`
    mutation ($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const TRANSITION = gql`
    mutation ($state: String!) {
        transitionOrderToState(state: $state) {
            ... on Order {
                id
                state
            }
            ... on OrderStateTransitionError {
                errorCode
                message
                transitionError
            }
        }
    }
`;

const ADD_PAYMENT = gql`
    mutation {
        addPaymentToOrder(input: { method: "test-payment", metadata: {} }) {
            ...CheckoutOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${ORDER_FIELDS}
`;

export interface PhoneCheckout {
    name?: string;
    phone: string;
    email?: string;
    alternatePhone?: string;
    districtId?: string;
    thanaId?: string;
    area?: string;
    streetLine1?: string;
    note?: string;
    variantId?: string;
    quantity?: number;
}

/** Fills the cart and the customer and address steps. Returns the active order's code. */
export async function prepareCheckout(shop: SimpleGraphQLClient, input: PhoneCheckout): Promise<string> {
    const { addItemToOrder } = await shop.query(ADD_ITEM, {
        variantId: input.variantId ?? 'T_1',
        quantity: input.quantity ?? 1,
    });
    if (addItemToOrder.errorCode) {
        throw new Error(`addItemToOrder: ${addItemToOrder.message}`);
    }
    const customer = await shop.query(SET_CUSTOMER, {
        input: {
            name: input.name ?? 'রহিম উদ্দিন',
            phone: input.phone,
            email: input.email,
            alternatePhone: input.alternatePhone,
        },
    });
    if (customer.setCustomerForOrderByPhone.reason) {
        throw new Error(`setCustomerForOrderByPhone: ${customer.setCustomerForOrderByPhone.reason}`);
    }
    const address = await shop.query(SET_ADDRESS, {
        input: {
            districtId: input.districtId ?? DHAKA,
            thanaId: input.thanaId ?? MIRPUR,
            area: input.area,
            streetLine1: input.streetLine1 ?? 'বাসা ১২, রোড ৫, মিরপুর ১০',
            note: input.note,
        },
    });
    if (address.setOrderShippingAddressBD.reason) {
        throw new Error(`setOrderShippingAddressBD: ${address.setOrderShippingAddressBD.reason}`);
    }
    await chooseDelivery(shop);
    return addItemToOrder.code;
}

/** Picks the first eligible delivery method for the active order. */
export async function chooseDelivery(shop: SimpleGraphQLClient) {
    const { eligibleShippingMethods } = await shop.query(SHIPPING_METHODS);
    await shop.query(SET_SHIPPING, { id: [eligibleShippingMethods[0].id] });
}

/** Moves the prepared order to payment and pays with the test method: the order is placed. */
export async function payAndPlace(shop: SimpleGraphQLClient) {
    const { transitionOrderToState } = await shop.query(TRANSITION, { state: 'ArrangingPayment' });
    if (transitionOrderToState.errorCode) {
        throw new Error(`transitionOrderToState: ${transitionOrderToState.transitionError}`);
    }
    const { addPaymentToOrder } = await shop.query(ADD_PAYMENT);
    if (addPaymentToOrder.errorCode) {
        throw new Error(`addPaymentToOrder: ${addPaymentToOrder.message}`);
    }
    return addPaymentToOrder;
}

/** A complete phone checkout in a fresh session. */
export async function placePhoneOrder(shop: SimpleGraphQLClient, input: PhoneCheckout) {
    await shop.asAnonymousUser();
    await prepareCheckout(shop, input);
    return payAndPlace(shop);
}

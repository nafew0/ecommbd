/**
 * Test data for browser tests, created through the real APIs of the running store: a product, a
 * delivery method and a test payment method (each created once, named "Playwright …"), and phone
 * orders placed the way a shopper would. On a developer's machine they stay in the dev database.
 */

const baseURL = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';
export const username = process.env.SUPERADMIN_USERNAME ?? 'superadmin';
export const password = process.env.SUPERADMIN_PASSWORD ?? 'superadmin';

export class ApiSession {
    private token?: string;

    constructor(private readonly api: 'admin-api' | 'shop-api') {}

    // Test data is read loosely: each call picks the few fields it needs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query<T = Record<string, any>>(query: string, variables?: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${baseURL}/${this.api}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            },
            body: JSON.stringify({ query, variables }),
        });
        this.token = response.headers.get('vendure-auth-token') ?? this.token;
        const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
        if (json.errors?.length) {
            throw new Error(`${this.api}: ${json.errors[0]!.message}`);
        }
        return json.data as T;
    }

    /** Uploads an image as an asset (GraphQL multipart, as the admin does). Returns its ID. */
    async uploadImage(data: Buffer, fileName: string, type: string): Promise<string> {
        const form = new FormData();
        const query =
            'mutation ($input: [CreateAssetInput!]!) { createAssets(input: $input) { ... on Asset { id } } }';
        form.append('operations', JSON.stringify({ query, variables: { input: [{ file: null }] } }));
        form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
        form.append('0', new Blob([new Uint8Array(data)], { type }), fileName);
        const response = await fetch(`${baseURL}/${this.api}`, {
            method: 'POST',
            body: form,
            headers: {
                'apollo-require-preflight': 'true',
                ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            },
        });
        const json = (await response.json()) as { data?: { createAssets: Array<{ id?: string }> } };
        const id = json.data?.createAssets[0]?.id;
        if (!id) throw new Error(`Upload refused: ${JSON.stringify(json)}`);
        return id;
    }
}

export async function adminSession(user = username, pass = password): Promise<ApiSession> {
    const admin = new ApiSession('admin-api');
    const { login } = await admin.query(
        'mutation ($u: String!, $p: String!) { login(username: $u, password: $p) { __typename } }',
        { u: user, p: pass },
    );
    if (login.__typename !== 'CurrentUser') {
        throw new Error(`Could not sign in as ${user}`);
    }
    return admin;
}

/** A random Bangladeshi mobile number, so test runs never collide. */
export function randomPhone(): string {
    return `0171${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

/** The product, delivery method and payment method checkout needs. Returns the variant to buy. */
export async function ensureCheckoutFixtures(admin: ApiSession): Promise<string> {
    const { products } = await admin.query(
        '{ products(options: { filter: { slug: { eq: "playwright-panjabi" } } }) { items { variants { id } } } }',
    );
    let variantId: string | undefined = products.items[0]?.variants[0]?.id;
    if (!variantId) {
        const { createProduct } = await admin.query(
            `mutation { createProduct(input: { translations: [{ languageCode: en, name: "Playwright panjabi",
                slug: "playwright-panjabi", description: "" }] }) { id } }`,
        );
        const { createProductVariants } = await admin.query(
            `mutation ($productId: ID!) { createProductVariants(input: [{ productId: $productId,
                sku: "PLAYWRIGHT-1", price: 125000, stockOnHand: 1000000,
                translations: [{ languageCode: en, name: "Playwright panjabi" }] }]) { id } }`,
            { productId: createProduct.id },
        );
        variantId = createProductVariants[0].id as string;
    }
    const { shippingMethods } = await admin.query(
        '{ shippingMethods(options: { filter: { code: { eq: "playwright-delivery" } } }) { totalItems } }',
    );
    if (!shippingMethods.totalItems) {
        await admin.query(`mutation { createShippingMethod(input: {
            code: "playwright-delivery", fulfillmentHandler: "manual-fulfillment",
            checker: { code: "default-shipping-eligibility-checker", arguments: [{ name: "orderMinimum", value: "0" }] },
            calculator: { code: "default-shipping-calculator", arguments: [
                { name: "rate", value: "6000" }, { name: "includesTax", value: "auto" }, { name: "taxRate", value: "0" }] },
            translations: [{ languageCode: en, name: "Playwright delivery", description: "" }] }) { id } }`);
    }
    const { paymentMethods } = await admin.query(
        '{ paymentMethods(options: { filter: { code: { eq: "playwright-payment" } } }) { totalItems } }',
    );
    if (!paymentMethods.totalItems) {
        await admin.query(`mutation { createPaymentMethod(input: {
            code: "playwright-payment", enabled: true,
            handler: { code: "dummy-payment-handler", arguments: [{ name: "automaticSettle", value: "false" }] },
            translations: [{ languageCode: en, name: "Playwright payment", description: "" }] }) { id } }`);
    }
    return variantId;
}

export interface PhoneOrderInput {
    variantId: string;
    name: string;
    phone: string;
    note?: string;
    /** House, road, village (default: a short Dhaka address). */
    streetLine1?: string;
    area?: string;
    /** Stop after the customer step: the shopper is known but no order is placed. */
    customerOnly?: boolean;
}

/** A shopper's phone checkout through the Shop API (a new session). Returns the order code. */
export async function placePhoneOrder(input: PhoneOrderInput): Promise<string> {
    const shop = new ApiSession('shop-api');
    const { addItemToOrder } = await shop.query(
        `mutation ($id: ID!) { addItemToOrder(productVariantId: $id, quantity: 1) {
            ... on Order { code } ... on ErrorResult { message } } }`,
        { id: input.variantId },
    );
    const customer = await shop.query(
        `mutation ($input: SetCustomerForOrderByPhoneInput!) { setCustomerForOrderByPhone(input: $input) {
            ... on BdCheckoutError { reason } } }`,
        { input: { name: input.name, phone: input.phone } },
    );
    if (customer.setCustomerForOrderByPhone.reason) {
        throw new Error(`setCustomerForOrderByPhone: ${customer.setCustomerForOrderByPhone.reason}`);
    }
    if (input.customerOnly) {
        return addItemToOrder.code as string;
    }
    await shop.query(
        `mutation ($input: SetOrderShippingAddressBDInput!) { setOrderShippingAddressBD(input: $input) {
            ... on BdCheckoutError { reason } } }`,
        {
            input: {
                districtId: 'BD3026',
                thanaId: 'BD3026M26',
                area: input.area ?? 'Mirpur 10',
                streetLine1: input.streetLine1 ?? 'House 12, Road 5, Block C',
                note: input.note,
            },
        },
    );
    const { eligibleShippingMethods } = await shop.query('{ eligibleShippingMethods { id code } }');
    const delivery = eligibleShippingMethods.find(
        (method: { code: string }) => method.code === 'playwright-delivery',
    );
    await shop.query(
        'mutation ($id: [ID!]!) { setOrderShippingMethod(shippingMethodId: $id) { __typename } }',
        {
            id: [delivery.id],
        },
    );
    const { transitionOrderToState } = await shop.query(
        `mutation { transitionOrderToState(state: "ArrangingPayment") {
            ... on OrderStateTransitionError { transitionError } } }`,
    );
    if (transitionOrderToState?.transitionError) {
        throw new Error(transitionOrderToState.transitionError);
    }
    await shop.query(
        `mutation { addPaymentToOrder(input: { method: "playwright-payment", metadata: {} }) {
            ... on Order { code } ... on ErrorResult { message } } }`,
    );
    return addItemToOrder.code as string;
}

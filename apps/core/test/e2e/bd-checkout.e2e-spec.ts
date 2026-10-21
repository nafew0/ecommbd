import { defaultShippingSettings } from '@ecommbd/shared';
import { Customer, TransactionalConnection } from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipPlaceholderRecipients } from '../../src/plugins/bd-checkout';
import {
    ADD_ITEM,
    chooseDelivery,
    DHAKA,
    KUSHTIA,
    MIRPUR,
    payAndPlace,
    placePhoneOrder,
    prepareCheckout,
    SET_ADDRESS,
    SET_CUSTOMER,
    TRANSITION,
} from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3054;
const sentEmails: Array<{ recipient: string }> = [];
const config = createTestConfig(
    PORT,
    {},
    { checkoutRateLimits: { customerPerPhone: { limit: 5, windowMs: 60 * 60_000 } } },
);
// The real email handlers with our filter, sending to a list instead of a mail server.
config.plugins.push(
    EmailPlugin.init({
        transport: { type: 'testing', onSend: details => void sentEmails.push(details) },
        handlers: skipPlaceholderRecipients(defaultEmailHandlers),
        templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../../static/email/templates')),
        globalTemplateVars: { fromAddress: '"Test shop" <noreply@example.com>' },
    }),
);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const shopUrl = `http://localhost:${PORT}/shop-api`;

const CUSTOMER = gql`
    query ($id: ID!) {
        customer(id: $id) {
            id
            firstName
            lastName
            emailAddress
            phoneNumber
            customFields {
                phone
                alternatePhone
                source
                orderCount
                cancelledCount
                deliveredCount
                totalSpent
                lastOrderAt
            }
        }
    }
`;

const ORDER = gql`
    query ($code: String!) {
        orders(options: { filter: { code: { eq: $code } } }) {
            items {
                id
                state
                customer {
                    id
                }
                customFields {
                    customerNote
                    contactEmail
                    locale
                }
                shippingAddress {
                    fullName
                    phoneNumber
                }
                payments {
                    id
                }
            }
        }
    }
`;

async function adminOrder(code: string) {
    return (await adminClient.query(ORDER, { code })).orders.items[0];
}

async function adminCustomer(id: string) {
    return (await adminClient.query(CUSTOMER, { id })).customer;
}

/** Errors of the two checkout mutations, in a fresh cart, in the given language. */
async function checkoutError(
    step: 'customer' | 'address',
    input: Record<string, unknown>,
    languageCode: 'en' | 'bn' = 'en',
) {
    await shopClient.asAnonymousUser();
    await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
    const result =
        step === 'customer'
            ? (await shopClient.query(SET_CUSTOMER, { input }, { languageCode })).setCustomerForOrderByPhone
            : (await shopClient.query(SET_ADDRESS, { input }, { languageCode })).setOrderShippingAddressBD;
    return result as { errorCode?: string; reason?: string; field?: string; message?: string };
}

/** Customers that have this phone (soft-deleted ones included). */
async function customersWithPhone(phone: string) {
    return server.app
        .get(TransactionalConnection)
        .rawConnection.getRepository(Customer)
        .count({ where: { customFields: { phone } } });
}

async function waitFor(check: () => boolean, ms = 5000) {
    const until = Date.now() + ms;
    while (!check() && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
});

afterAll(async () => {
    await server.destroy();
});

describe('phone checkout', () => {
    it('places an order with only name, phone and a district/thana address: no email anywhere', async () => {
        await shopClient.asAnonymousUser();
        const code = await prepareCheckout(shopClient, {
            name: '  রহিম   উদ্দিন ',
            phone: '০১৭১১-০০০০০১',
            area: 'মিরপুর ১০',
            note: 'বিকেল ৫টার পরে দিন',
        });
        const placed = await payAndPlace(shopClient);
        expect(placed).toMatchObject({
            state: 'PaymentAuthorized',
            active: false,
            shippingAddress: {
                fullName: 'রহিম উদ্দিন',
                phoneNumber: '+8801711000001',
                city: 'Mirpur',
                province: 'Dhaka',
                countryCode: 'BD',
                customFields: { districtId: DHAKA, thanaId: MIRPUR, area: 'মিরপুর ১০' },
            },
            customFields: { customerNote: 'বিকেল ৫টার পরে দিন' },
        });
        // What the shopper's own session sees: what they typed, never a placeholder email.
        expect(placed.customer).toMatchObject({ firstName: 'রহিম উদ্দিন', emailAddress: '' });
        expect(JSON.stringify(placed)).not.toContain('phone.invalid');

        const order = await adminOrder(code);
        expect(order.customFields).toEqual({
            customerNote: 'বিকেল ৫টার পরে দিন',
            contactEmail: null,
            locale: 'bn',
        });
        const customer = await adminCustomer(order.customer.id);
        expect(customer).toMatchObject({
            firstName: 'রহিম উদ্দিন',
            lastName: '',
            emailAddress: '8801711000001@phone.invalid',
            customFields: { phone: '+8801711000001', source: 'web' },
        });
    });

    it('gives the same customer for the same phone; each order keeps the name typed for it', async () => {
        const first = await placePhoneOrder(shopClient, { name: 'Karim', phone: '01711000002' });
        const second = await placePhoneOrder(shopClient, {
            name: 'Karim’s mother',
            phone: '+880 1711-000002',
        });
        const [a, b] = [await adminOrder(first.code), await adminOrder(second.code)];
        expect(a.customer.id).toBe(b.customer.id);
        expect(b.shippingAddress.fullName).toBe('Karim’s mother');
        expect((await adminCustomer(a.customer.id)).firstName).toBe('Karim');
        expect(await customersWithPhone('+8801711000002')).toBe(1);
    });

    it('handles two checkouts creating the same new phone at the same moment', async () => {
        const shoppers = [new SimpleGraphQLClient(config, shopUrl), new SimpleGraphQLClient(config, shopUrl)];
        for (const shopper of shoppers) {
            await shopper.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        }
        const results = await Promise.all(
            shoppers.map((shopper, index) =>
                shopper.query(SET_CUSTOMER, { input: { name: `Twin ${index}`, phone: '01711000003' } }),
            ),
        );
        for (const { setCustomerForOrderByPhone } of results) {
            expect(setCustomerForOrderByPhone.reason).toBeUndefined();
        }
        expect(await customersWithPhone('+8801711000003')).toBe(1);
        const codes = await Promise.all(
            shoppers.map(
                async shopper =>
                    (
                        await shopper.query(gql`
                            {
                                activeOrder {
                                    code
                                }
                            }
                        `)
                    ).activeOrder.code,
            ),
        );
        const [a, b] = await Promise.all(codes.map(adminOrder));
        expect(a.customer.id).toBe(b.customer.id);
    });

    it('keeps an email that belongs to another customer on the order only', async () => {
        const owner = await placePhoneOrder(shopClient, { phone: '01711000004', email: 'Owner@Example.com' });
        const ownerOrder = await adminOrder(owner.code);
        expect((await adminCustomer(ownerOrder.customer.id)).emailAddress).toBe('owner@example.com');

        const other = await placePhoneOrder(shopClient, { phone: '01711000005', email: 'owner@example.com' });
        const otherOrder = await adminOrder(other.code);
        expect(otherOrder.customer.id).not.toBe(ownerOrder.customer.id);
        expect(otherOrder.customFields.contactEmail).toBe('owner@example.com');
        expect((await adminCustomer(otherOrder.customer.id)).emailAddress).toBe(
            '8801711000005@phone.invalid',
        );

        // A phone-only customer who later gives a free email gets it in place of the placeholder.
        const later = await placePhoneOrder(shopClient, {
            phone: '01711000005',
            email: 'second@example.com',
        });
        const laterOrder = await adminOrder(later.code);
        expect(laterOrder.customFields.contactEmail).toBeNull();
        expect((await adminCustomer(laterOrder.customer.id)).emailAddress).toBe('second@example.com');
    });

    it('accepts names in Bangla, with emoji, or one word; rejects blank and too long', async () => {
        for (const name of ['মিম 🌸', 'Rahim', 'শাহানা পারভীন']) {
            const result = await checkoutError('customer', { name, phone: '01711000006' });
            expect(result.reason).toBeUndefined();
        }
        expect(await checkoutError('customer', { name: '   ', phone: '01711000006' })).toMatchObject({
            errorCode: 'BD_CHECKOUT_ERROR',
            reason: 'NAME_REQUIRED',
            field: 'name',
            message: 'Enter your name.',
        });
        expect(
            await checkoutError('customer', { name: 'a'.repeat(101), phone: '01711000006' }),
        ).toMatchObject({
            reason: 'NAME_TOO_LONG',
        });
    });
});

describe('typed errors in Bangla and English', () => {
    const cases: Array<[string, 'customer' | 'address', Record<string, unknown>, string, string]> = [
        [
            'INVALID_PHONE',
            'customer',
            { name: 'R', phone: '12345' },
            'Enter a valid mobile number',
            'সঠিক মোবাইল',
        ],
        [
            'NOT_A_MOBILE',
            'customer',
            { name: 'R', phone: '02-9123456' },
            'Enter a mobile number',
            'ল্যান্ডফোন',
        ],
        ['NAME_REQUIRED', 'customer', { name: ' ', phone: '01711000007' }, 'Enter your name', 'নাম লিখুন'],
        ['NAME_TOO_LONG', 'customer', { name: 'ক'.repeat(101), phone: '01711000007' }, 'at most 100', '১০০'],
        [
            'UNKNOWN_DISTRICT',
            'address',
            { districtId: 'BD9999', thanaId: MIRPUR, streetLine1: 'House 12, Road 5' },
            'Choose your district',
            'জেলা বেছে নিন',
        ],
        [
            'THANA_NOT_IN_DISTRICT',
            'address',
            { districtId: KUSHTIA, thanaId: MIRPUR, streetLine1: 'House 12, Road 5' },
            'not in the selected district',
            'নির্বাচিত জেলার মধ্যে নয়',
        ],
        [
            'ADDRESS_TOO_SHORT',
            'address',
            { districtId: DHAKA, thanaId: MIRPUR, streetLine1: 'Mirpur' },
            'full address',
            'পুরো ঠিকানা',
        ],
    ];

    it.each(cases)('%s', async (code, step, input, english, bangla) => {
        const en = await checkoutError(step, input, 'en');
        expect(en).toMatchObject({ errorCode: 'BD_CHECKOUT_ERROR', reason: code });
        expect(en.message).toContain(english);
        const bn = await checkoutError(step, input, 'bn');
        expect(bn).toMatchObject({ reason: code });
        expect(bn.message).toContain(bangla);
    });

    it('asks for the area when the thana is not listed, and checks the alternate phone', async () => {
        expect(
            await checkoutError('address', {
                districtId: DHAKA,
                thanaId: 'other',
                streetLine1: 'House 12, Road 5',
            }),
        ).toMatchObject({ reason: 'AREA_REQUIRED', field: 'area' });
        expect(
            await checkoutError('customer', { name: 'R', phone: '01711000008', alternatePhone: '123' }),
        ).toMatchObject({ reason: 'INVALID_ALTERNATE_PHONE', field: 'alternatePhone' });
    });

    it('rejects a foreign number unless the store allows them', async () => {
        expect(await checkoutError('customer', { name: 'R', phone: '+44 7911 123456' })).toMatchObject({
            reason: 'INVALID_PHONE',
        });
        const UPDATE = gql`
            mutation ($input: JSON!) {
                updateBdCheckoutSettings(input: $input) {
                    settings
                    errors {
                        path
                        code
                    }
                }
            }
        `;
        const { bdCheckoutSettings } = await adminClient.query(gql`
            {
                bdCheckoutSettings
            }
        `);
        await adminClient.query(UPDATE, { input: { ...bdCheckoutSettings, allowInternationalPhones: true } });
        const { bdCheckoutSettings: shopSettings } = await shopClient.query(gql`
            {
                bdCheckoutSettings {
                    allowInternationalPhones
                    minAddressLength
                }
            }
        `);
        expect(shopSettings).toEqual({ allowInternationalPhones: true, minAddressLength: 10 });
        expect(
            (await checkoutError('customer', { name: 'R', phone: '+44 7911 123456' })).reason,
        ).toBeUndefined();
        await adminClient.query(UPDATE, { input: bdCheckoutSettings });
        const invalid = await adminClient.query(UPDATE, {
            input: { ...bdCheckoutSettings, minAddressLength: -1 },
        });
        expect(invalid.updateBdCheckoutSettings).toEqual({
            settings: null,
            errors: [{ path: 'minAddressLength', code: 'invalid' }],
        });
    });

    it('refuses with a clear error when there is no cart', async () => {
        await shopClient.asAnonymousUser();
        const { setCustomerForOrderByPhone } = await shopClient.query(SET_CUSTOMER, {
            input: { name: 'R', phone: '01711000009' },
        });
        expect(setCustomerForOrderByPhone).toMatchObject({ reason: 'NO_ACTIVE_ORDER' });
    });
});

describe('payment guard', () => {
    const SET_CUSTOMER_VENDURE = gql`
        mutation ($input: CreateCustomerInput!) {
            setCustomerForOrder(input: $input) {
                ... on Order {
                    id
                    customer {
                        id
                    }
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `;
    const SET_ADDRESS_VENDURE = gql`
        mutation ($input: CreateAddressInput!) {
            setOrderShippingAddress(input: $input) {
                ... on Order {
                    id
                }
            }
        }
    `;

    it('blocks payment without a phone, in English and Bangla (older clients using an email)', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_CUSTOMER_VENDURE, {
            input: { firstName: 'Old', lastName: 'Client', emailAddress: 'old-client@example.com' },
        });
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: DHAKA, thanaId: MIRPUR, streetLine1: 'House 12, Road 5' },
        });
        await chooseDelivery(shopClient);
        const en = (await shopClient.query(TRANSITION, { state: 'ArrangingPayment' })).transitionOrderToState;
        expect(en.transitionError).toBe('Add the customer’s mobile number before payment.');
        const bn = (await shopClient.query(TRANSITION, { state: 'ArrangingPayment' }, { languageCode: 'bn' }))
            .transitionOrderToState;
        expect(bn.transitionError).toBe('পেমেন্টের আগে কাস্টমারের মোবাইল নম্বর দিন।');
    });

    it('lets older clients that send a phone with setCustomerForOrder check out, linked by phone', async () => {
        const known = await placePhoneOrder(shopClient, { phone: '01711000010' });
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        const { setCustomerForOrder } = await shopClient.query(SET_CUSTOMER_VENDURE, {
            input: {
                firstName: 'Someone',
                lastName: 'Else',
                emailAddress: 'someone@example.com',
                phoneNumber: '01711-000010',
            },
        });
        expect(setCustomerForOrder.errorCode).toBeUndefined();
        const code = (
            await shopClient.query(gql`
                {
                    activeOrder {
                        code
                    }
                }
            `)
        ).activeOrder.code;
        expect((await adminOrder(code)).customer.id).toBe((await adminOrder(known.code)).customer.id);
        // The name on file stays the first one.
        expect((await adminCustomer((await adminOrder(code)).customer.id)).firstName).toBe('রহিম উদ্দিন');
    });

    it('blocks payment without a district/thana address', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_CUSTOMER, { input: { name: 'R', phone: '01711000011' } });
        await shopClient.query(SET_ADDRESS_VENDURE, {
            input: { streetLine1: 'House 12, Road 5', countryCode: 'BD' },
        });
        // Without a district only Store pickup can be chosen (phase 07), so turn it on for this test.
        const pickup = (enabled: boolean) =>
            adminClient.query(
                gql`
                    mutation ($input: JSON!) {
                        updateBdShippingSettings(input: $input) {
                            errors {
                                path
                            }
                        }
                    }
                `,
                { input: { ...defaultShippingSettings(), pickup: { enabled } } },
            );
        await pickup(true);
        try {
            await chooseDelivery(shopClient);
            const { transitionOrderToState } = await shopClient.query(TRANSITION, {
                state: 'ArrangingPayment',
            });
            expect(transitionOrderToState.transitionError).toBe(
                'Add a delivery address with district and thana before payment.',
            );
        } finally {
            await pickup(false);
        }
    });
});

describe('privacy', () => {
    it('links a guest to a registered customer’s phone without revealing anything about the account', async () => {
        const { customers } = await adminClient.query(gql`
            {
                customers {
                    items {
                        id
                        firstName
                        emailAddress
                        user {
                            id
                        }
                    }
                }
            }
        `);
        const registered = customers.items.find((item: { user: unknown }) => item.user);
        await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Customer)
            .update(registered.id.replace('T_', ''), { customFields: { phone: '+8801711000012' } });

        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { variantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_CUSTOMER, { input: { name: 'A guest', phone: '01711000012' } });
        const { activeOrder } = await shopClient.query(gql`
            {
                activeOrder {
                    code
                    customer {
                        id
                        firstName
                        lastName
                        emailAddress
                        phoneNumber
                        user {
                            id
                            identifier
                        }
                        addresses {
                            id
                        }
                        orders {
                            totalItems
                        }
                    }
                }
            }
        `);
        expect(activeOrder.customer).toEqual({
            id: expect.not.stringMatching(new RegExp(`^${registered.id}$`)),
            firstName: 'A guest',
            lastName: '',
            emailAddress: '',
            phoneNumber: '+8801711000012',
            user: null,
            addresses: [],
            orders: { totalItems: 0 },
        });
        expect(JSON.stringify(activeOrder)).not.toContain(registered.emailAddress);
        // Still linked to the account for history and stats.
        expect((await adminOrder(activeOrder.code)).customer.id).toBe(registered.id);
    });

    it('never emails a placeholder address (the order confirmation goes only to real emails)', async () => {
        const SETTLE = gql`
            mutation ($id: ID!) {
                settlePayment(id: $id) {
                    ... on Payment {
                        state
                    }
                }
            }
        `;
        const settle = async (code: string) => {
            const order = await adminOrder(code);
            await adminClient.query(SETTLE, { id: order.payments[0].id });
        };
        const phoneOnly = await placePhoneOrder(shopClient, { phone: '01711000013' });
        const withEmail = await placePhoneOrder(shopClient, {
            phone: '01711000014',
            email: 'real@example.com',
        });
        await settle(phoneOnly.code);
        await settle(withEmail.code);
        await waitFor(() => sentEmails.some(email => email.recipient === 'real@example.com'));
        expect(sentEmails.map(email => email.recipient)).toContain('real@example.com');
        expect(sentEmails.some(email => email.recipient.endsWith('.invalid'))).toBe(false);
    });
});

describe('rate limits', () => {
    it('refuses more than 5 tries per phone in an hour, with a clear message', async () => {
        const phone = '01711000015';
        for (let attempt = 1; attempt <= 5; attempt++) {
            expect((await checkoutError('customer', { name: 'R', phone })).reason).toBeUndefined();
        }
        const limited = await checkoutError('customer', { name: 'R', phone }, 'bn');
        expect(limited).toMatchObject({ reason: 'RATE_LIMITED' });
        expect(limited.message).toContain('কয়েক মিনিট পরে');
    });
});

describe('customers in the admin', () => {
    const SEARCH = gql`
        query ($search: String) {
            bdCustomers(search: $search) {
                totalItems
                items {
                    firstName
                    customFields {
                        phone
                    }
                }
            }
        }
    `;
    const phones = async (search: string) =>
        (await adminClient.query(SEARCH, { search })).bdCustomers.items.map(
            (item: { customFields: { phone: string } }) => item.customFields.phone,
        );

    it('finds customers by the last digits, Bangla digits, a full number or the name', async () => {
        expect(await phones('000002')).toEqual(['+8801711000002']);
        expect(await phones('০০০০০২')).toEqual(['+8801711000002']);
        expect(await phones('01711-000002')).toEqual(['+8801711000002']);
        expect(await phones('+880 1711 000002')).toEqual(['+8801711000002']);
        expect(await phones('karim')).toEqual(['+8801711000002']);
        expect(await phones('01711')).toEqual(expect.arrayContaining(['+8801711000001', '+8801711000002']));
        expect(await phones('99999999')).toEqual([]);
    });

    it('needs ReadCustomer', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(SEARCH, { search: '0001' })).rejects.toThrow(
            /not currently authorized/,
        );
        await adminClient.asSuperAdmin();
    });

    it('keeps order stats on the customer, updated when an order changes', async () => {
        const placed = await placePhoneOrder(shopClient, { phone: '01711000016' });
        const order = await adminOrder(placed.code);
        await waitFor(() => false, 300);
        expect((await adminCustomer(order.customer.id)).customFields).toMatchObject({
            orderCount: 1,
            cancelledCount: 0,
        });
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    cancelBdOrder(input: { orderId: $id, reason: "customerCancelled" }) {
                        ... on Order {
                            state
                        }
                    }
                }
            `,
            { id: order.id },
        );
        await waitFor(() => false, 300);
        expect((await adminCustomer(order.customer.id)).customFields).toMatchObject({
            orderCount: 1,
            cancelledCount: 1,
            totalSpent: 0,
        });
    });
});

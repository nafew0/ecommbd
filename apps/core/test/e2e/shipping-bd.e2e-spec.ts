import { defaultShippingSettings, type ShippingSettings, takaToMinor } from '@ecommbd/shared';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DHAKA, MIRPUR, prepareCheckout, SET_ADDRESS } from '../support/checkout';
import {
    addMigrationOnlyObjects,
    createTestConfig,
    testInitialData,
    testProductsCsvPath,
} from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3057;
const config = createTestConfig(PORT);
const { server, adminClient, shopClient } = createTestEnvironment(config);
const adminUrl = `http://localhost:${PORT}/admin-api`;

const SAVAR = 'BD30260072';
const RAJSHAHI = 'BD5081';
const PABA = 'BD50810072';
const CHATTOGRAM = 'BD2015';
const CHATTOGRAM_KOTWALI = 'BD2015M11';

const tk = takaToMinor;

const DELIVERY = `
    bdDelivery {
        zone
        unavailableReason
        unavailableMessage
        freeDeliveryThreshold
        freeDeliveryRemaining
    }
`;

const ACTIVE_ORDER = gql`
    query {
        activeOrder {
            id
            subTotalWithTax
            shippingWithTax
            totalWithTax
            shippingLines {
                shippingMethod {
                    code
                }
            }
            ${DELIVERY}
        }
    }
`;

const ELIGIBLE = gql`
    query {
        eligibleShippingMethods {
            id
            code
            name
            price
            priceWithTax
            metadata
        }
    }
`;

const SET_SHIPPING = gql`
    mutation ($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            ... on Order {
                shippingWithTax
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const ADJUST = gql`
    mutation ($lineId: ID!, $quantity: Int!) {
        adjustOrderLine(orderLineId: $lineId, quantity: $quantity) {
            ... on Order {
                shippingWithTax
            }
        }
    }
`;

const LINES = gql`
    query {
        activeOrder {
            lines {
                id
            }
        }
    }
`;

const SETTINGS = gql`
    query {
        bdShippingSettings
    }
`;

const UPDATE_SETTINGS = gql`
    mutation ($input: JSON!) {
        updateBdShippingSettings(input: $input) {
            settings
            errors {
                path
                code
            }
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation ($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;

const UPDATE_VARIANTS = gql`
    mutation ($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`;

const MISSING_WEIGHT = gql`
    query {
        bdProductsMissingWeight {
            totalItems
            items {
                variantId
                name
                sku
            }
        }
    }
`;

async function saveSettings(patch: Partial<ShippingSettings> = {}) {
    const { updateBdShippingSettings } = await adminClient.query(UPDATE_SETTINGS, {
        input: { ...defaultShippingSettings(), ...patch },
    });
    expect(updateBdShippingSettings.errors).toEqual([]);
    return updateBdShippingSettings.settings as ShippingSettings;
}

async function resetProducts() {
    await adminClient.query(UPDATE_PRODUCT, {
        input: {
            id: 'T_1',
            customFields: {
                freeDelivery: false,
                deliveryInsideDhaka: null,
                deliveryOutsideDhaka: null,
                deliverySurcharge: 0,
            },
        },
    });
    await adminClient.query(UPDATE_VARIANTS, {
        input: [{ id: 'T_1', customFields: { weightGrams: null } }],
    });
}

let phoneSuffix = 100;
/** A new cart with one panjabi (৳1,250) delivered to the given place. */
async function cart(place: { districtId: string; thanaId?: string; area?: string }, quantity = 1) {
    await shopClient.asAnonymousUser();
    phoneSuffix += 1;
    await prepareCheckout(shopClient, { phone: `01712345${phoneSuffix}`, quantity, ...place }).catch(
        async error => {
            // No delivery method: prepareCheckout's last step can't choose one; the cart is still set.
            if (!String(error).includes('Cannot read')) throw error;
        },
    );
}

async function eligible() {
    const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE);
    return eligibleShippingMethods as Array<{ id: string; code: string; priceWithTax: number }>;
}

const prices = async () => (await eligible()).map(method => [method.code, method.priceWithTax]);

beforeAll(async () => {
    await server.init({
        initialData: testInitialData,
        productsCsvPath: testProductsCsvPath,
        customerCount: 1,
    });
    await addMigrationOnlyObjects(server);
    await adminClient.asSuperAdmin();
}, 120_000);

afterAll(async () => {
    await server.destroy();
});

beforeEach(async () => {
    await adminClient.asSuperAdmin();
    await saveSettings();
    await resetProducts();
});

describe('default delivery charges', () => {
    it('charges ৳60 in Mirpur, ৳100 in Savar and ৳120 in Rajshahi, with Standard only', async () => {
        await cart({ districtId: DHAKA, thanaId: MIRPUR });
        expect(await prices()).toEqual([['bd-standard', tk(60)]]);
        await cart({ districtId: DHAKA, thanaId: SAVAR });
        expect(await prices()).toEqual([['bd-standard', tk(100)]]);
        await cart({ districtId: RAJSHAHI, thanaId: PABA });
        expect(await prices()).toEqual([['bd-standard', tk(120)]]);
        // Chattogram city pays the outside-Dhaka rate unless the merchant gives it its own.
        await cart({ districtId: CHATTOGRAM, thanaId: CHATTOGRAM_KOTWALI });
        expect(await prices()).toEqual([['bd-standard', tk(120)]]);
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder.shippingWithTax).toBe(tk(120));
        expect(activeOrder.totalWithTax).toBe(tk(1250 + 120));
    });

    it('offers nothing in Dhaka district without a thana, and says why in Bangla', async () => {
        await cart({ districtId: DHAKA, thanaId: 'other', area: 'Notun Bazar' });
        expect(await eligible()).toEqual([]);
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER, {}, { languageCode: 'bn' });
        expect(activeOrder.bdDelivery).toMatchObject({
            zone: null,
            unavailableReason: 'NO_DISTRICT',
            unavailableMessage: 'ডেলিভারি চার্জ দেখতে জেলা ও থানা বেছে নিন।',
        });
        const { activeOrder: english } = await shopClient.query(ACTIVE_ORDER, {}, { languageCode: 'en' });
        expect(english.bdDelivery.unavailableMessage).toBe(
            'Choose the district and thana to see the delivery charge.',
        );
    });

    it('recalculates when the shopper changes district', async () => {
        await cart({ districtId: DHAKA, thanaId: MIRPUR });
        expect((await shopClient.query(ACTIVE_ORDER)).activeOrder.shippingWithTax).toBe(tk(60));
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: RAJSHAHI, thanaId: PABA, streetLine1: 'House 4, Kazla, Rajshahi' },
        });
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder.shippingWithTax).toBe(tk(120));
        expect(activeOrder.bdDelivery.zone).toBe('outside_dhaka');
    });
});

describe('free delivery threshold', () => {
    it('is free from the threshold, says how much is left, and comes back below it', async () => {
        await saveSettings({
            freeAbove: { dhaka_city: tk(2000), dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
        });
        await cart({ districtId: DHAKA, thanaId: MIRPUR });
        let { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder.shippingWithTax).toBe(tk(60));
        expect(activeOrder.bdDelivery).toMatchObject({
            freeDeliveryThreshold: tk(2000),
            freeDeliveryRemaining: tk(750),
        });

        const { activeOrder: withLines } = await shopClient.query(LINES);
        const lineId = withLines.lines[0].id;
        const { adjustOrderLine: two } = await shopClient.query(ADJUST, { lineId, quantity: 2 });
        expect(two.shippingWithTax).toBe(0);
        ({ activeOrder } = await shopClient.query(ACTIVE_ORDER));
        expect(activeOrder.bdDelivery.freeDeliveryRemaining).toBe(0);

        const { adjustOrderLine: one } = await shopClient.query(ADJUST, { lineId, quantity: 1 });
        expect(one.shippingWithTax).toBe(tk(60));

        // Outside Dhaka has no threshold here.
        await cart({ districtId: RAJSHAHI, thanaId: PABA }, 4);
        ({ activeOrder } = await shopClient.query(ACTIVE_ORDER));
        expect(activeOrder.shippingWithTax).toBe(tk(120));
        expect(activeOrder.bdDelivery.freeDeliveryRemaining).toBeNull();
    });
});

describe('methods', () => {
    it('lists Express and pickup when turned on, cheapest first, and drops Express where it isn’t offered', async () => {
        await saveSettings({
            express: {
                enabled: true,
                rates: { dhaka_city: tk(120), dhaka_suburb: null, chattogram_city: null, outside_dhaka: null },
            },
            pickup: { enabled: true },
        });
        await cart({ districtId: DHAKA, thanaId: MIRPUR });
        const methods = await eligible();
        expect(methods.map(method => [method.code, method.priceWithTax])).toEqual([
            ['bd-pickup', 0],
            ['bd-standard', tk(60)],
            ['bd-express', tk(120)],
        ]);
        const express = methods.find(method => method.code === 'bd-express')!;
        const { setOrderShippingMethod } = await shopClient.query(SET_SHIPPING, { id: [express.id] });
        expect(setOrderShippingMethod.shippingWithTax).toBe(tk(120));

        // Moving to Rajshahi: Express isn't offered there, so the cheapest eligible method replaces it.
        await shopClient.query(SET_ADDRESS, {
            input: { districtId: RAJSHAHI, thanaId: PABA, streetLine1: 'House 4, Kazla, Rajshahi' },
        });
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder.shippingLines[0].shippingMethod.code).not.toBe('bd-express');
        expect(await prices()).toEqual([
            ['bd-pickup', 0],
            ['bd-standard', tk(120)],
        ]);
    });

    it('delivers only where the merchant says', async () => {
        await saveSettings({ coverage: { zones: ['dhaka_city'], districtIds: [], maxWeightGrams: null } });
        await cart({ districtId: RAJSHAHI, thanaId: PABA });
        expect(await eligible()).toEqual([]);
        const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
        expect(activeOrder.bdDelivery.unavailableReason).toBe('NOT_DELIVERED_HERE');
    });
});

describe('product delivery fields', () => {
    it('uses the product’s own charges and free delivery', async () => {
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { deliveryInsideDhaka: tk(80), deliveryOutsideDhaka: tk(150) } },
        });
        await cart({ districtId: DHAKA, thanaId: MIRPUR });
        expect(await prices()).toEqual([['bd-standard', tk(80)]]);
        await cart({ districtId: RAJSHAHI, thanaId: PABA });
        expect(await prices()).toEqual([['bd-standard', tk(150)]]);

        await adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_1', customFields: { freeDelivery: true } } });
        await cart({ districtId: RAJSHAHI, thanaId: PABA });
        expect(await prices()).toEqual([['bd-standard', 0]]);
    });

    it('adds the weight surcharge, and lists variants without a weight', async () => {
        const { bdProductsMissingWeight: before } = await adminClient.query(MISSING_WEIGHT);
        expect(before.items.map((item: { sku: string }) => item.sku)).toEqual(['PANJABI-1', 'SAREE-1']);

        await saveSettings({ weight: { enabled: true, includedGrams: 1000, perKg: tk(20) } });
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: 'T_1', customFields: { weightGrams: 800 } }] });
        await cart({ districtId: DHAKA, thanaId: MIRPUR }, 3);
        // 2,400 g: 1,000 g included, then 2 started kilograms at ৳20.
        expect(await prices()).toEqual([['bd-standard', tk(60 + 40)]]);

        const { bdProductsMissingWeight: after } = await adminClient.query(MISSING_WEIGHT);
        expect(after).toMatchObject({ totalItems: 1, items: [{ sku: 'SAREE-1' }] });
    });

    it('refuses fractional taka on a product', async () => {
        await expect(
            adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_1', customFields: { deliveryInsideDhaka: 6050 } } }),
        ).rejects.toThrow(/whole taka/);
    });
});

describe('settings', () => {
    it('starts as unconfirmed suggestions, and is confirmed once saved', async () => {
        // beforeEach saved them already; the defaults themselves say unconfirmed.
        expect(defaultShippingSettings().confirmed).toBe(false);
        const { bdShippingSettings } = await adminClient.query(SETTINGS);
        expect(bdShippingSettings).toMatchObject({ confirmed: true, standard: { rates: { dhaka_city: tk(60) } } });
    });

    it('returns field errors for bad amounts and unknown places', async () => {
        const settings = defaultShippingSettings();
        const { updateBdShippingSettings } = await adminClient.query(UPDATE_SETTINGS, {
            input: {
                ...settings,
                standard: { ...settings.standard, rates: { ...settings.standard.rates, dhaka_city: -100 } },
            },
        });
        expect(updateBdShippingSettings).toEqual({
            settings: null,
            errors: [{ path: 'standard.rates.dhaka_city', code: 'invalid' }],
        });
        const { updateBdShippingSettings: unknown } = await adminClient.query(UPDATE_SETTINGS, {
            input: { ...settings, overrides: [{ kind: 'district', id: 'BD9999', rate: tk(100) }] },
        });
        expect(unknown.errors).toEqual([{ path: 'overrides.0.id', code: 'notFound' }]);
    });

    it('applies a district override', async () => {
        await saveSettings({ overrides: [{ kind: 'district', id: RAJSHAHI, rate: tk(150) }] });
        await cart({ districtId: RAJSHAHI, thanaId: PABA });
        expect(await prices()).toEqual([['bd-standard', tk(150)]]);
    });

    it('can be read by a packer but changed only with UpdateShippingMethod', async () => {
        const { roles } = await adminClient.query(gql`
            {
                roles(options: { filter: { code: { eq: "packer" } } }) {
                    items {
                        id
                    }
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($input: CreateAdministratorInput!) {
                    createAdministrator(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    firstName: 'Jamal',
                    lastName: 'Packer',
                    emailAddress: 'packer@example.com',
                    password: 'staff-password-123',
                    roleIds: [roles.items[0].id],
                },
            },
        );
        const packer = new SimpleGraphQLClient(config, adminUrl);
        await packer.asUserWithCredentials('packer@example.com', 'staff-password-123');
        const { bdShippingSettings } = await packer.query(SETTINGS);
        expect(bdShippingSettings.standard.rates.dhaka_city).toBe(tk(60));
        await expect(packer.query(UPDATE_SETTINGS, { input: defaultShippingSettings() })).rejects.toThrow(
            /not currently authorized/,
        );
    });
});

describe('manual orders', () => {
    it('use the same rules as the checkout', async () => {
        const DRAFT = gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `;
        const { createDraftOrder } = await adminClient.query(DRAFT);
        const orderId = createDraftOrder.id;
        await adminClient.query(
            gql`
                mutation ($orderId: ID!) {
                    addItemToDraftOrder(orderId: $orderId, input: { productVariantId: "T_1", quantity: 1 }) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            { orderId },
        );
        await adminClient.query(
            gql`
                mutation ($orderId: ID!, $input: CreateAddressInput!) {
                    setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
                        id
                    }
                }
            `,
            {
                orderId,
                input: {
                    fullName: 'Karim',
                    streetLine1: 'House 9, Savar Bazar',
                    countryCode: 'BD',
                    phoneNumber: '+8801712345678',
                    customFields: { districtId: DHAKA, thanaId: SAVAR },
                },
            },
        );
        const { eligibleShippingMethodsForDraftOrder } = await adminClient.query(
            gql`
                query ($orderId: ID!) {
                    eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
                        code
                        priceWithTax
                    }
                }
            `,
            { orderId },
        );
        expect(eligibleShippingMethodsForDraftOrder).toEqual([{ code: 'bd-standard', priceWithTax: tk(100) }]);
        const { order } = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        ${DELIVERY}
                    }
                }
            `,
            { id: orderId },
        );
        expect(order.bdDelivery.zone).toBe('dhaka_suburb');
    });
});

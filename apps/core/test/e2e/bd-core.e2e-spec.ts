import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestConfig, testInitialData } from '../support/test-config';

registerInitializer('postgres', new PostgresInitializer());

const PORT = 3053;
const BASE = `http://localhost:${PORT}`;
const { server, adminClient, shopClient } = createTestEnvironment(createTestConfig(PORT));

const DHAKA = 'BD3026';
const MIRPUR = 'BD3026M26';
const KUSHTIA = 'BD4050';
const OWNER_PHONE = '+8801912345678';

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 1 });
    await adminClient.asSuperAdmin();
});

afterAll(async () => {
    await server.destroy();
});

describe('place lists (geo API)', () => {
    it('lists the 64 districts in the Shop API, in Bangla when asked', async () => {
        const { bdDistricts } = await shopClient.query(gql`
            query {
                bdDistricts(lang: bn) {
                    id
                    name
                    nameEn
                    divisionId
                }
            }
        `);
        expect(bdDistricts).toHaveLength(64);
        expect(bdDistricts).toContainEqual({ id: DHAKA, name: 'ঢাকা', nameEn: 'Dhaka', divisionId: 'BD30' });
    });

    it('lists a district’s thanas with type and delivery zone, in both APIs', async () => {
        const query = gql`
            query ($districtId: String!) {
                bdThanas(districtId: $districtId, lang: en) {
                    id
                    name
                    type
                    zone
                }
            }
        `;
        const shop = await shopClient.query(query, { districtId: DHAKA });
        expect(shop.bdThanas).toHaveLength(55);
        expect(shop.bdThanas).toContainEqual({
            id: MIRPUR,
            name: 'Mirpur',
            type: 'metro_thana',
            zone: 'dhaka_city',
        });
        expect(shop.bdThanas).toContainEqual({
            id: 'BD30260072',
            name: 'Savar',
            type: 'upazila',
            zone: 'dhaka_suburb',
        });
        const admin = await adminClient.query(query, { districtId: DHAKA });
        expect(admin.bdThanas).toEqual(shop.bdThanas);
        expect((await shopClient.query(query, { districtId: 'nowhere' })).bdThanas).toEqual([]);
    });

    it('serves the same lists as cacheable GET requests (Cache-Control, ETag, 304)', async () => {
        const first = await fetch(`${BASE}/bd-geo/districts/${DHAKA}/thanas?lang=bn`);
        expect(first.status).toBe(200);
        expect(first.headers.get('cache-control')).toContain('public');
        const body = await first.json();
        expect(body.thanas.find((thana: { id: string }) => thana.id === MIRPUR).name).toBe('মিরপুর');
        const etag = first.headers.get('etag')!;
        const again = await fetch(`${BASE}/bd-geo/districts/${DHAKA}/thanas?lang=bn`, {
            headers: { 'if-none-match': etag },
        });
        expect(again.status).toBe(304);
        const districts = await (await fetch(`${BASE}/bd-geo/districts`)).json();
        expect(districts.districts).toHaveLength(64);
        expect(districts.dataVersion).toMatch(/^\d{4}\.\d+$/);
    });
});

describe('addresses', () => {
    const CREATE_ADDRESS = gql`
        mutation ($customerId: ID!, $input: CreateAddressInput!) {
            createCustomerAddress(customerId: $customerId, input: $input) {
                id
                city
                province
                customFields {
                    districtId
                    thanaId
                    area
                    landmark
                    alternatePhone
                }
            }
        }
    `;
    let customerId: string;

    beforeAll(async () => {
        const { customers } = await adminClient.query(gql`
            query {
                customers {
                    items {
                        id
                    }
                }
            }
        `);
        customerId = customers.items[0].id;
    });

    const address = (customFields: Record<string, unknown>) => ({
        fullName: 'রহিম উদ্দিন',
        streetLine1: 'বাসা ১২, রোড ৫',
        countryCode: 'BD',
        phoneNumber: '+8801712345678',
        customFields,
    });

    it('fills city and province in English from the IDs and cleans the other fields', async () => {
        const { createCustomerAddress } = await adminClient.query(CREATE_ADDRESS, {
            customerId,
            input: address({
                districtId: DHAKA,
                thanaId: MIRPUR,
                area: '  মিরপুর   ১০ ',
                landmark: '',
                alternatePhone: '০১৮১২-৩৪৫৬৭৮',
            }),
        });
        expect(createCustomerAddress).toMatchObject({
            city: 'Mirpur',
            province: 'Dhaka',
            customFields: {
                districtId: DHAKA,
                thanaId: MIRPUR,
                area: 'মিরপুর ১০',
                landmark: null,
                alternatePhone: '+8801812345678',
            },
        });
    });

    it('rejects a thana from another district, in English and in Bangla', async () => {
        const input = address({ districtId: KUSHTIA, thanaId: MIRPUR });
        await expect(adminClient.query(CREATE_ADDRESS, { customerId, input })).rejects.toThrow(
            'This thana is not in the selected district.',
        );
        await expect(
            adminClient.query(CREATE_ADDRESS, { customerId, input }, { languageCode: 'bn' }),
        ).rejects.toThrow('এই থানাটি নির্বাচিত জেলার মধ্যে নয়।');
    });

    it('accepts "Other / not listed" only with the area written in', async () => {
        await expect(
            adminClient.query(CREATE_ADDRESS, {
                customerId,
                input: address({ districtId: DHAKA, thanaId: 'other' }),
            }),
        ).rejects.toThrow('Write the area name when the thana is not listed.');
        const { createCustomerAddress } = await adminClient.query(CREATE_ADDRESS, {
            customerId,
            input: address({ districtId: DHAKA, thanaId: 'other', area: 'New Town' }),
        });
        expect(createCustomerAddress).toMatchObject({ city: 'New Town', province: 'Dhaka' });
    });

    it('needs district and thana together, and a valid alternate phone', async () => {
        await expect(
            adminClient.query(CREATE_ADDRESS, { customerId, input: address({ districtId: DHAKA }) }),
        ).rejects.toThrow('Send the district and the thana together.');
        await expect(
            adminClient.query(CREATE_ADDRESS, {
                customerId,
                input: address({ districtId: DHAKA, thanaId: MIRPUR, alternatePhone: '12345' }),
            }),
        ).rejects.toThrow('The alternate phone number is not a valid Bangladeshi number.');
    });

    it('applies the same checks to order addresses, which carry the same custom fields', async () => {
        const { createDraftOrder } = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `);
        const SET_SHIPPING = gql`
            mutation ($orderId: ID!, $input: CreateAddressInput!) {
                setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
                    shippingAddress {
                        city
                        province
                        customFields {
                            districtId
                            thanaId
                            area
                        }
                    }
                }
            }
        `;
        await expect(
            adminClient.query(SET_SHIPPING, {
                orderId: createDraftOrder.id,
                input: address({ districtId: KUSHTIA, thanaId: MIRPUR }),
            }),
        ).rejects.toThrow('This thana is not in the selected district.');
        const { setDraftOrderShippingAddress } = await adminClient.query(SET_SHIPPING, {
            orderId: createDraftOrder.id,
            input: address({ districtId: KUSHTIA, thanaId: 'BD40500094', area: 'Amla' }),
        });
        expect(setDraftOrderShippingAddress.shippingAddress).toMatchObject({
            city: 'Mirpur',
            province: 'Kushtia',
            customFields: { districtId: KUSHTIA, thanaId: 'BD40500094', area: 'Amla' },
        });
    });
});

describe('store settings', () => {
    const SETTINGS = gql`
        query {
            bdStoreSettings {
                settings
                history {
                    administratorName
                    fields
                }
                warnings
            }
        }
    `;
    const UPDATE = gql`
        mutation ($input: JSON!) {
            updateBdStoreSettings(input: $input) {
                settings
                errors {
                    path
                    code
                }
            }
        }
    `;

    async function currentSettings() {
        return (await adminClient.query(SETTINGS)).bdStoreSettings.settings;
    }

    it('validates, normalizes (Bangla digits) and saves the settings, and records who changed what', async () => {
        const settings = await currentSettings();
        settings.profile.storeName = { bn: 'রহিম ফ্যাশন', en: 'Rahim Fashion' };
        settings.profile.phones = ['০১৭১২৩৪৫৬৭৮'];
        settings.profile.ownerPhone = '01912345678';
        settings.profile.address = {
            line: 'বাসা ১২, রোড ৫',
            area: 'মিরপুর ১০',
            districtId: DHAKA,
            thanaId: MIRPUR,
        };
        const { updateBdStoreSettings } = await adminClient.query(UPDATE, { input: settings });
        expect(updateBdStoreSettings.errors).toEqual([]);
        expect(updateBdStoreSettings.settings.profile.phones).toEqual(['+8801712345678']);
        expect(updateBdStoreSettings.settings.profile.ownerPhone).toBe(OWNER_PHONE);
        const { bdStoreSettings } = await adminClient.query(SETTINGS);
        expect(bdStoreSettings.history[0]).toEqual({
            administratorName: 'Super Admin',
            fields: expect.arrayContaining(['profile.storeName.bn', 'profile.phones', 'profile.ownerPhone']),
        });
        expect(bdStoreSettings.warnings).toEqual([]);
    });

    it('returns field errors as codes and saves nothing', async () => {
        const settings = await currentSettings();
        settings.profile.storeName = { bn: '', en: '' };
        settings.profile.whatsapp = '02-9123456';
        settings.profile.address.thanaId = 'BD40500094';
        const { updateBdStoreSettings } = await adminClient.query(UPDATE, { input: settings });
        expect(updateBdStoreSettings.settings).toBeNull();
        expect(updateBdStoreSettings.errors).toEqual(
            expect.arrayContaining([
                { path: 'profile.storeName', code: 'required' },
                { path: 'profile.whatsapp', code: 'invalidMobile' },
            ]),
        );
        expect((await currentSettings()).profile.storeName.en).toBe('Rahim Fashion');
        settings.profile.storeName = { bn: 'রহিম ফ্যাশন', en: 'Rahim Fashion' };
        settings.profile.whatsapp = '';
        const second = await adminClient.query(UPDATE, { input: settings });
        expect(second.updateBdStoreSettings.errors).toEqual([
            { path: 'profile.address.thanaId', code: 'notFound' },
        ]);
    });

    it('marks a policy as reviewed once its text is edited', async () => {
        const settings = await currentSettings();
        settings.policies.terms.bn = `${settings.policies.terms.bn}\n\nআমাদের নিজস্ব শর্ত।`;
        const { updateBdStoreSettings } = await adminClient.query(UPDATE, { input: settings });
        expect(updateBdStoreSettings.settings.policies.terms.isTemplate).toBe(false);
        expect(updateBdStoreSettings.settings.policies.returnPolicy.isTemplate).toBe(true);
    });

    it('changes the storefront’s default language (the channel’s) from the settings', async () => {
        const settings = await currentSettings();
        settings.locale.defaultLanguage = 'en';
        await adminClient.query(UPDATE, { input: settings });
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    defaultLanguageCode
                }
            }
        `);
        expect(activeChannel.defaultLanguageCode).toBe('en');
        settings.locale.defaultLanguage = 'bn';
        await adminClient.query(UPDATE, { input: settings });
    });

    it('never sends private fields to the Shop API', async () => {
        const { bdStoreSettings } = await shopClient.query(gql`
            query {
                bdStoreSettings {
                    profile {
                        storeName {
                            bn
                            en
                        }
                        phones
                        whatsapp
                        email
                        tradeLicenceNumber
                        address {
                            line
                            districtId
                            thanaId
                        }
                        logo {
                            id
                        }
                    }
                    policies {
                        terms {
                            bn
                        }
                    }
                    locale {
                        defaultLanguage
                        banglaDigits
                    }
                }
            }
        `);
        expect(bdStoreSettings.profile.storeName.en).toBe('Rahim Fashion');
        expect(JSON.stringify(bdStoreSettings)).not.toContain(OWNER_PHONE);
        // The private field isn't even in the Shop API schema.
        await expect(
            shopClient.query(gql`
                query {
                    bdStoreSettings {
                        profile {
                            ownerPhone
                        }
                    }
                }
            `),
        ).rejects.toThrow(/Cannot query field "ownerPhone"/);
        // Nor can the shop read the raw settings through Vendure's settings store API (Admin API only).
        await expect(
            shopClient.query(gql`
                query {
                    getSettingsStoreValue(key: "bdStore.settings")
                }
            `),
        ).rejects.toThrow();
    });

    it('needs UpdateStoreSettings: order staff can read the settings but not change them', async () => {
        const { roles } = await adminClient.query(gql`
            query {
                roles(options: { take: 50 }) {
                    items {
                        id
                        code
                    }
                }
            }
        `);
        const roleId = (code: string) => roles.items.find((role: { code: string }) => role.code === code).id;
        const createAdmin = (email: string, code: string) =>
            adminClient.query(
                gql`
                    mutation ($input: CreateAdministratorInput!) {
                        createAdministrator(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        firstName: 'Staff',
                        lastName: code,
                        emailAddress: email,
                        password: 'staff-password-123',
                        roleIds: [roleId(code)],
                    },
                },
            );
        await createAdmin('orders@example.com', 'order-staff');
        await createAdmin('owner@example.com', 'owner');

        await adminClient.asUserWithCredentials('orders@example.com', 'staff-password-123');
        const settings = await currentSettings();
        await expect(adminClient.query(UPDATE, { input: settings })).rejects.toThrow(
            /not currently authorized/,
        );
        await expect(
            adminClient.query(gql`
                mutation {
                    setSettingsStoreValue(input: { key: "bdStore.settings", value: {} }) {
                        result
                    }
                }
            `),
        ).resolves.toMatchObject({ setSettingsStoreValue: { result: false } });

        await adminClient.asUserWithCredentials('owner@example.com', 'staff-password-123');
        settings.profile.businessHours = { bn: 'শনি–বৃহস্পতি, সকাল ১০টা–রাত ৮টা', en: 'Sat–Thu, 10am–8pm' };
        const { updateBdStoreSettings } = await adminClient.query(UPDATE, { input: settings });
        expect(updateBdStoreSettings.errors).toEqual([]);
        expect((await adminClient.query(SETTINGS)).bdStoreSettings.history[0].administratorName).toBe(
            'Staff owner',
        );
        await adminClient.asSuperAdmin();
    });

    it('stores each staff member’s admin language separately', async () => {
        const SET = gql`
            mutation ($value: JSON!) {
                setSettingsStoreValue(input: { key: "bdAdmin.language", value: $value }) {
                    result
                    error
                }
            }
        `;
        const GET = gql`
            query {
                getSettingsStoreValue(key: "bdAdmin.language")
            }
        `;
        expect((await adminClient.query(SET, { value: 'en' })).setSettingsStoreValue.result).toBe(true);
        expect((await adminClient.query(SET, { value: 'fr' })).setSettingsStoreValue.result).toBe(false);
        await adminClient.asUserWithCredentials('owner@example.com', 'staff-password-123');
        expect((await adminClient.query(GET)).getSettingsStoreValue).toBeNull();
        await adminClient.asSuperAdmin();
        expect((await adminClient.query(GET)).getSettingsStoreValue).toBe('en');
    });
});

describe('API and admin protection', () => {
    it('refuses form posts to the API (CSRF prevention)', async () => {
        const response = await fetch(`${BASE}/admin-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'query=mutation{login(username:"superadmin",password:"superadmin"){__typename}}',
        });
        expect(response.status).toBe(400);
    });

    it('serves /admin with a strict Content Security Policy, and redirects /admin to /admin/', async () => {
        const redirect = await fetch(`${BASE}/admin`, { redirect: 'manual' });
        expect(redirect.status).toBe(301);
        expect(redirect.headers.get('location')).toBe('/admin/');
        const page = await fetch(`${BASE}/admin/settings/store`);
        expect([200, 503]).toContain(page.status);
        const csp = page.headers.get('content-security-policy')!;
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');
        // The Admin API next to it still works.
        const api = await fetch(`${BASE}/admin-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: '{ bdGeoDataVersion }' }),
        });
        expect((await api.json()).data.bdGeoDataVersion).toMatch(/^\d{4}\.\d+$/);
    });
});

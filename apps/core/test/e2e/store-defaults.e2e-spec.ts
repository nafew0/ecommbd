import { createTestEnvironment, PostgresInitializer, registerInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StoreDefaultsService } from '../../src/plugins/bd-core';
import { createTestConfig, testInitialData } from '../support/test-config';

// A fresh database: the store-defaults initializer runs when the test server first starts.
registerInitializer('postgres', new PostgresInitializer());

const { server, adminClient } = createTestEnvironment(createTestConfig(3052));

const STORE_STATE = gql`
    query StoreState {
        activeChannel {
            id
            defaultCurrencyCode
            availableCurrencyCodes
            pricesIncludeTax
            defaultLanguageCode
            availableLanguageCodes
            defaultTaxZone {
                name
            }
            defaultShippingZone {
                name
            }
        }
        globalSettings {
            availableLanguages
            trackInventory
            outOfStockThreshold
        }
        countries(options: { take: 1000 }) {
            totalItems
            items {
                code
                enabled
                translations {
                    languageCode
                    name
                }
            }
        }
        zones(options: { take: 100 }) {
            items {
                name
                members {
                    code
                }
            }
        }
        taxCategories {
            items {
                name
                isDefault
            }
        }
        taxRates {
            items {
                name
                value
                enabled
                zone {
                    name
                }
                category {
                    name
                }
            }
        }
        roles(options: { take: 100 }) {
            items {
                code
                permissions
            }
        }
    }
`;

interface StoreState {
    activeChannel: {
        id: string;
        defaultCurrencyCode: string;
        availableCurrencyCodes: string[];
        pricesIncludeTax: boolean;
        defaultLanguageCode: string;
        availableLanguageCodes: string[];
        defaultTaxZone: { name: string };
        defaultShippingZone: { name: string };
    };
    globalSettings: { availableLanguages: string[]; trackInventory: boolean; outOfStockThreshold: number };
    countries: {
        totalItems: number;
        items: Array<{
            code: string;
            enabled: boolean;
            translations: Array<{ languageCode: string; name: string }>;
        }>;
    };
    zones: { items: Array<{ name: string; members: Array<{ code: string }> }> };
    taxCategories: { items: Array<{ name: string; isDefault: boolean }> };
    taxRates: {
        items: Array<{
            name: string;
            value: number;
            enabled: boolean;
            zone: { name: string };
            category: { name: string };
        }>;
    };
    roles: { items: Array<{ code: string; permissions: string[] }> };
}

const storeState = () => adminClient.query<StoreState>(STORE_STATE);
const runInitializer = (force = false) => server.app.get(StoreDefaultsService).run({ force });

beforeAll(async () => {
    await server.init({ initialData: testInitialData, customerCount: 0 });
    await adminClient.asSuperAdmin();
});

afterAll(async () => {
    await server.destroy();
});

describe('store defaults on a fresh database', () => {
    it('sets the channel to BDT, prices including tax, Bangla (default) and English', async () => {
        const { activeChannel } = await storeState();
        expect(activeChannel).toMatchObject({
            defaultCurrencyCode: 'BDT',
            availableCurrencyCodes: ['BDT'],
            pricesIncludeTax: true,
            defaultLanguageCode: 'bn',
            availableLanguageCodes: ['bn', 'en'],
            defaultTaxZone: { name: 'Bangladesh' },
            defaultShippingZone: { name: 'Bangladesh' },
        });
    });

    it('makes Bangla and English available and tracks stock', async () => {
        const { globalSettings } = await storeState();
        expect(globalSettings.availableLanguages).toEqual(expect.arrayContaining(['bn', 'en']));
        expect(globalSettings.trackInventory).toBe(true);
        expect(globalSettings.outOfStockThreshold).toBe(0);
    });

    it('creates every country in both languages, with only Bangladesh enabled', async () => {
        const { countries } = await storeState();
        expect(countries.totalItems).toBe(249);
        expect(countries.items.filter(country => country.enabled).map(country => country.code)).toEqual([
            'BD',
        ]);
        const bangladesh = countries.items.find(country => country.code === 'BD')!;
        expect(bangladesh.translations).toEqual(
            expect.arrayContaining([
                { languageCode: 'en', name: 'Bangladesh' },
                { languageCode: 'bn', name: 'বাংলাদেশ' },
            ]),
        );
    });

    it('creates the Bangladesh zone and a 0% standard tax', async () => {
        const { zones, taxCategories, taxRates } = await storeState();
        expect(zones.items.find(zone => zone.name === 'Bangladesh')?.members).toEqual([{ code: 'BD' }]);
        expect(taxCategories.items).toEqual([{ name: 'Standard', isDefault: true }]);
        expect(taxRates.items).toEqual([
            {
                name: 'Standard VAT 0%',
                value: 0,
                enabled: true,
                zone: { name: 'Bangladesh' },
                category: { name: 'Standard' },
            },
        ]);
    });

    it('defines the five staff roles with their permission sets', async () => {
        const { roles } = await storeState();
        const byCode = new Map(roles.items.map(role => [role.code, role.permissions]));
        for (const code of ['owner', 'manager', 'order-staff', 'packer', 'marketing']) {
            expect(byCode.has(code), code).toBe(true);
        }
        expect(byCode.get('owner')).toEqual(
            expect.arrayContaining(['UpdateStoreSettings', 'CreateAdministrator']),
        );
        expect(byCode.get('manager')).not.toContain('UpdateStoreSettings');
        expect(byCode.get('manager')).not.toContain('CreateAdministrator');
        expect(byCode.get('order-staff')).toEqual(
            expect.arrayContaining(['ReadOrder', 'UpdateOrder', 'CreateOrder']),
        );
        expect(byCode.get('packer')).not.toContain('UpdateCustomer');
        expect(byCode.get('marketing')).toEqual(expect.arrayContaining(['CreatePromotion', 'ReadOrder']));
        expect(byCode.get('marketing')).not.toContain('UpdateOrder');
    });

    it('creates the store settings with policy templates to review', async () => {
        const { bdStoreSettings } = await adminClient.query(gql`
            query {
                bdStoreSettings {
                    settings
                }
            }
        `);
        expect(bdStoreSettings.settings.policies.returnPolicy.isTemplate).toBe(true);
        expect(bdStoreSettings.settings.policies.returnPolicy.bn).toContain('৭২ ঘণ্টার');
        expect(bdStoreSettings.settings.locale.defaultLanguage).toBe('bn');
    });
});

describe('running the initializer again', () => {
    it('skips every step and changes nothing', async () => {
        const before = await storeState();
        const report = await runInitializer();
        expect(report.map(step => step.status)).toEqual(report.map(() => 'skipped'));
        expect(report.map(step => step.id)).toEqual([
            'global-settings',
            'countries',
            'zone-bangladesh',
            'tax-standard',
            'channel',
            'roles',
            'store-settings',
            // Registered by later plugins (registerStoreDefaults), in the order their files load:
            'delivery-methods',
            'order-permissions',
            'payment-methods',
            'payment-permissions',
            'staff-payment-method',
            'manual-order-permissions',
            'content-permissions',
            'content-menus',
            'slug-history-backfill',
            'print-permissions',
            'fraud-permissions',
            'search-synonyms',
        ]);
        expect(await storeState()).toEqual(before);
    });

    it('keeps a merchant’s changes (currency switched to USD)', async () => {
        const { activeChannel } = await storeState();
        await adminClient.query(
            gql`
                mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            {
                input: {
                    id: activeChannel.id,
                    defaultCurrencyCode: 'USD',
                    availableCurrencyCodes: ['USD', 'BDT'],
                },
            },
        );
        await runInitializer();
        expect((await storeState()).activeChannel.defaultCurrencyCode).toBe('USD');
    });

    it('warns on the settings page when the currency is not BDT', async () => {
        const { bdStoreSettings } = await adminClient.query(gql`
            query {
                bdStoreSettings {
                    warnings
                }
            }
        `);
        expect(bdStoreSettings.warnings).toEqual(['currencyNotBdt']);
    });

    it('re-applies the defaults only with --force (operations staff)', async () => {
        const report = await runInitializer(true);
        expect(report.every(step => step.status === 'done')).toBe(true);
        const state = await storeState();
        expect(state.activeChannel.defaultCurrencyCode).toBe('BDT');
        // Forcing never duplicates what exists.
        expect(state.countries.totalItems).toBe(249);
        expect(state.zones.items.filter(zone => zone.name === 'Bangladesh')).toHaveLength(1);
        expect(state.taxRates.items).toHaveLength(1);
        expect(state.roles.items.filter(role => role.code === 'owner')).toHaveLength(1);
    });
});

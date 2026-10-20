import {
    ChannelService,
    Country,
    CountryService,
    CurrencyCode,
    GlobalSettingsService,
    isGraphQlErrorResult,
    LanguageCode,
    type Permission,
    Role,
    RoleService,
    TaxCategoryService,
    TaxRate,
    TaxRateService,
    TransactionalConnection,
    ZoneService,
    type RequestContext,
    type Injector,
} from '@vendure/core';
import { countryName, ISO_COUNTRY_CODES } from './countries';
import type { StoreDefaultsStep } from './registry';
import { STORE_ROLES } from './roles';

export const BANGLADESH_ZONE = 'Bangladesh';
export const STANDARD_TAX_CATEGORY = 'Standard';

async function findCountry(ctx: RequestContext, injector: Injector, code: string) {
    return injector.get(TransactionalConnection).getRepository(ctx, Country).findOne({ where: { code } });
}

async function findBangladeshZone(ctx: RequestContext, injector: Injector) {
    const zones = await injector.get(ZoneService).getAllWithMembers(ctx);
    return zones.find(zone => zone.name === BANGLADESH_ZONE);
}

/**
 * Bangladesh defaults for every new store (roadmap phase 02). Each step only creates what is
 * missing; the channel step sets values once and then leaves them to the merchant.
 */
export const coreStoreDefaults: StoreDefaultsStep[] = [
    {
        id: 'global-settings',
        description: 'Bangla and English available; stock tracked; out of stock at 0',
        async run({ ctx, injector }) {
            const service = injector.get(GlobalSettingsService);
            const current = await service.getSettings(ctx);
            const availableLanguages = [
                ...new Set([...current.availableLanguages, LanguageCode.bn, LanguageCode.en]),
            ];
            await service.updateSettings(ctx, {
                availableLanguages,
                trackInventory: true,
                outOfStockThreshold: 0,
            });
            return [`languages ${availableLanguages.join(', ')}`, 'stock tracked, out of stock at 0'];
        },
    },
    {
        id: 'countries',
        description: 'All countries in English and Bangla; only Bangladesh enabled',
        async run({ ctx, injector }) {
            const service = injector.get(CountryService);
            const existing = await injector.get(TransactionalConnection).getRepository(ctx, Country).find();
            const existingCodes = new Set(existing.map(country => country.code));
            const missing = ISO_COUNTRY_CODES.filter(code => !existingCodes.has(code));
            for (const code of missing) {
                await service.create(ctx, {
                    code,
                    enabled: code === 'BD',
                    translations: [
                        { languageCode: LanguageCode.en, name: countryName(code, 'en') },
                        { languageCode: LanguageCode.bn, name: countryName(code, 'bn') },
                    ],
                });
            }
            return missing.length ? [`${missing.length} countries added`] : [];
        },
    },
    {
        id: 'zone-bangladesh',
        description: 'A "Bangladesh" zone for tax and shipping',
        async run({ ctx, injector }) {
            if (await findBangladeshZone(ctx, injector)) {
                return [];
            }
            const bangladesh = await findCountry(ctx, injector, 'BD');
            await injector
                .get(ZoneService)
                .create(ctx, { name: BANGLADESH_ZONE, memberIds: bangladesh ? [bangladesh.id] : [] });
            return [`zone ${BANGLADESH_ZONE} created`];
        },
    },
    {
        id: 'tax-standard',
        description: 'Tax category "Standard" with a 0% rate in Bangladesh',
        async run({ ctx, injector }) {
            const notes: string[] = [];
            const zone = await findBangladeshZone(ctx, injector);
            const categories = await injector.get(TaxCategoryService).findAll(ctx);
            let standard = categories.items.find(category => category.name === STANDARD_TAX_CATEGORY);
            if (!standard) {
                standard = await injector
                    .get(TaxCategoryService)
                    .create(ctx, { name: STANDARD_TAX_CATEGORY, isDefault: true });
                notes.push(`tax category ${STANDARD_TAX_CATEGORY} created`);
            }
            if (!zone) {
                return notes;
            }
            const rates = await injector
                .get(TransactionalConnection)
                .getRepository(ctx, TaxRate)
                .find({ relations: { zone: true, category: true } });
            const hasRate = rates.some(rate => rate.zone.id === zone.id && rate.category.id === standard.id);
            if (!hasRate) {
                await injector.get(TaxRateService).create(ctx, {
                    name: 'Standard VAT 0%',
                    enabled: true,
                    value: 0,
                    categoryId: standard.id,
                    zoneId: zone.id,
                });
                notes.push('0% standard tax rate created');
            }
            return notes;
        },
    },
    {
        id: 'channel',
        description: 'Default channel in BDT, prices including tax, Bangla and English',
        async run({ ctx, injector, options }) {
            const service = injector.get(ChannelService);
            const channel = await service.getDefaultChannel(ctx);
            const zone = await findBangladeshZone(ctx, injector);
            const result = await service.update(ctx, {
                id: channel.id,
                defaultCurrencyCode: CurrencyCode.BDT,
                availableCurrencyCodes: [CurrencyCode.BDT],
                pricesIncludeTax: true,
                availableLanguageCodes: [LanguageCode.bn, LanguageCode.en],
                defaultLanguageCode: options.defaultLanguage === 'bn' ? LanguageCode.bn : LanguageCode.en,
                ...(zone ? { defaultTaxZoneId: zone.id, defaultShippingZoneId: zone.id } : {}),
            });
            if (isGraphQlErrorResult(result)) {
                throw new Error(`Could not update the default channel: ${result.message}`);
            }
            return [`BDT, prices include tax, languages bn + en, default ${options.defaultLanguage}`];
        },
    },
    {
        id: 'roles',
        description: 'Staff roles: Owner, Manager, Order staff, Packer, Marketing',
        async run({ ctx, injector }) {
            const service = injector.get(RoleService);
            const roles = injector.get(TransactionalConnection).getRepository(ctx, Role);
            const channel = await injector.get(ChannelService).getDefaultChannel(ctx);
            const created: string[] = [];
            for (const role of STORE_ROLES) {
                if (await roles.findOne({ where: { code: role.code } })) {
                    continue;
                }
                await service.create(ctx, {
                    code: role.code,
                    description: role.description,
                    permissions: role.permissions as Permission[],
                    channelIds: [channel.id],
                });
                created.push(role.code);
            }
            return created.length ? [`roles created: ${created.join(', ')}`] : [];
        },
    },
];

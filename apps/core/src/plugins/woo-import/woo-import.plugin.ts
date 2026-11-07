import { OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, PluginCommonModule, RoleService, ScheduledTask, VendurePlugin } from '@vendure/core';
import { registerStoreDefaults } from '../bd-core';
import { BdImagesPlugin } from '../bd-images';
import { WooHelperService } from './helper.service';
import { WooHelperController } from './helper.controller';
import { WooExtrasService } from './extras.service';
import { WooRedirectService } from './redirect.service';
import { WooChunk, WooPairing, WooLegacyAuth, WooRedirect, WooMiss, WooExtra } from './helper-entities';
import { WooPasswordHashingStrategy } from './passwords';
import { json } from 'express';
import { runMigrationPermission, schema, shopSchema, WooImportResolver, WooUrlResolver } from './api';
import { LegacyOrder, WooIssue, WooMapping, WooRun, WooSource } from './entities';
import { ImportMapperService } from './import-mapper.service';
import { WooOpenOrderService } from './open-order.service';
import { WOO_OPTIONS, WooImportOptions, WooImportService } from './woo-import.service';

registerStoreDefaults({
    id: 'woo-import-permission-v1',
    description: 'WooCommerce migration access for store owners',
    async run({ ctx, injector }) {
        const roles = injector.get(RoleService);
        const all = await roles.findAll(ctx, { take: 100 });
        for (const role of all.items.filter(r => r.code === 'owner')) {
            if (!role.permissions.includes(runMigrationPermission.Permission))
                await roles.update(ctx, {
                    id: role.id,
                    permissions: [...role.permissions, runMigrationPermission.Permission],
                });
        }
        return [];
    },
});
const en = {
    freshUpload: 'Create a fresh helper pairing and upload the changed source before running catch-up.',
    pairing: 'The pairing code or upload token is invalid, expired or revoked. Create a new pairing.',
    chunk: 'This upload was refused: check its signature, timestamp, sequence and size.',
    helperNotReady: 'Wait for the WordPress helper to finish uploading before starting an import.',
    redirectLoop: 'This rule creates a redirect loop. Choose a final page instead.',
    connection:
        'Could not read the WooCommerce API ({reason}). Check HTTPS, Read keys and security-plugin access.',
    settings:
        'The source currency could not be read. Check that these read-only keys can read WooCommerce settings.',
    number: 'The original order number is too long or is already in use. Review it before conversion.',
    encryption: 'Configure migration encryption keys before connecting a store.',
    notFound: 'This migration record was not found.',
    input: 'Check the source address, read-only credentials and import settings.',
    credentials: 'Reconnect with read-only WooCommerce keys to continue.',
    busy: 'An import is already running for this source.',
    review: 'Complete a dry run and review its report before importing.',
    queue: 'The migration could not be queued. Resume it after the worker is available.',
    freeze: 'Confirm that the old checkout is frozen and whether its stock already excludes these open orders.',
    openOrder:
        'This order needs manual handling. Only recent, unpaid COD orders with supported items and no discounts or tax can be converted.',
    address: 'Review the phone, district, thana and delivery address first.',
    stock: 'The order could not reserve its items. Review the stock.',
    quote: 'The destination totals differ from WooCommerce. Review the order instead of changing the old totals.',
};
const bn: Record<keyof typeof en, string> = {
    freshUpload: 'শেষ পরিবর্তন সিঙ্ক করার আগে নতুন পেয়ারিং করে পুরোনো স্টোরের তথ্য আবার আপলোড করুন।',
    pairing: 'পেয়ারিং কোড বা আপলোড টোকেন ভুল, মেয়াদ শেষ বা বাতিল হয়েছে। নতুন পেয়ারিং করুন।',
    chunk: 'আপলোড নেওয়া যায়নি। স্বাক্ষর, সময়, ক্রম ও আকার যাচাই করুন।',
    helperNotReady: 'ইমপোর্ট শুরুর আগে WordPress থেকে সব তথ্য আপলোড হওয়া পর্যন্ত অপেক্ষা করুন।',
    redirectLoop: 'এই নিয়মে একই ঠিকানায় ঘুরে ফিরে আসে। শেষ পাতার ঠিকানা দিন।',
    connection:
        'WooCommerce API পড়া যায়নি ({reason})। HTTPS, Read অনুমতির কী এবং নিরাপত্তা প্লাগইনের অনুমতি দেখুন।',
    settings: 'পুরোনো স্টোরের মুদ্রা জানা যায়নি। কী দিয়ে WooCommerce সেটিংস পড়ার অনুমতি আছে কি না দেখুন।',
    number: 'পুরোনো অর্ডার নম্বরটি বেশি বড় বা আগেই ব্যবহার হয়েছে। রূপান্তরের আগে যাচাই করুন।',
    encryption: 'স্টোর যুক্ত করার আগে মাইগ্রেশনের এনক্রিপশন কী সেট করুন।',
    notFound: 'মাইগ্রেশনের তথ্য পাওয়া যায়নি।',
    input: 'স্টোরের ঠিকানা, শুধু পড়ার অনুমতির কী এবং ইমপোর্ট সেটিংস যাচাই করুন।',
    credentials: 'চালিয়ে যেতে WooCommerce-এর শুধু পড়ার অনুমতির কী দিয়ে আবার যুক্ত করুন।',
    busy: 'এই স্টোরের একটি ইমপোর্ট চলছে।',
    review: 'ইমপোর্টের আগে ড্রাই রান করে রিপোর্ট যাচাই করুন।',
    queue: 'মাইগ্রেশন চালু করা যায়নি। ওয়ার্কার চালু হলে আবার চালান।',
    freeze: 'পুরোনো চেকআউট বন্ধ আছে এবং স্টক থেকে এই অর্ডারের পণ্য আগেই বাদ দেওয়া হয়েছে কি না নিশ্চিত করুন।',
    openOrder:
        'অর্ডারটি আলাদাভাবে যাচাই করুন। শুধু সাম্প্রতিক, টাকা না পাওয়া, ছাড় ও করবিহীন COD অর্ডার রূপান্তর করা যায়।',
    address: 'আগে ফোন, জেলা, থানা ও ডেলিভারির ঠিকানা যাচাই করুন।',
    stock: 'অর্ডারের পণ্য সংরক্ষণ করা যায়নি। স্টক যাচাই করুন।',
    quote: 'নতুন স্টোরের মোট টাকা WooCommerce-এর সঙ্গে মেলেনি। পুরোনো মোট টাকা না বদলে অর্ডারটি যাচাই করুন।',
};

@VendurePlugin({
    imports: [PluginCommonModule, BdImagesPlugin],
    entities: [
        WooSource,
        WooRun,
        WooMapping,
        WooIssue,
        LegacyOrder,
        WooChunk,
        WooPairing,
        WooLegacyAuth,
        WooRedirect,
        WooMiss,
        WooExtra,
    ],
    controllers: [WooHelperController],
    providers: [
        ImportMapperService,
        WooImportService,
        WooOpenOrderService,
        WooHelperService,
        WooExtrasService,
        WooRedirectService,
        { provide: WOO_OPTIONS, useFactory: () => WooImportPlugin.options },
    ],
    adminApiExtensions: { schema, resolvers: [WooImportResolver] },
    shopApiExtensions: { schema: shopSchema, resolvers: [WooUrlResolver] },
    configuration: config => {
        config.apiOptions.middleware = [
            ...(config.apiOptions.middleware ?? []),
            { route: '/woo-migrate', beforeListen: true, handler: json({ limit: '2mb' }) },
        ];
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            new ScheduledTask({
                id: 'woo-secret-expiry',
                description: 'Expire unused WooCommerce credentials',
                schedule: '19 3 * * *',
                execute: ({ injector }) => injector.get(WooHelperService).cleanup(),
            }),
        ];
        config.authOptions.passwordHashingStrategy = new WooPasswordHashingStrategy(
            WooImportPlugin.options.encryptionKeys,
        );
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            runMigrationPermission,
        ];
        return config;
    },
    compatibility: '^3.8.0',
})
export class WooImportPlugin implements OnApplicationBootstrap {
    static options: WooImportOptions = {};
    static init(options: WooImportOptions) {
        this.options = options;
        return this;
    }
    constructor(private i18n: I18nService) {}
    onApplicationBootstrap() {
        this.i18n.addTranslation('en', { error: { 'woo-import': en } });
        this.i18n.addTranslation('bn', { error: { 'woo-import': bn } });
    }
}

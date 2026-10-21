import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    type CustomFieldConfig,
    Ctx,
    type ID,
    LanguageCode,
    Permission,
    PluginCommonModule,
    RequestContext,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import { updateStoreSettingsPermission } from '../bd-core';
import { NOTIFICATIONS_PLUGIN_OPTIONS } from './constants';
import { OrderSmsService } from './order-sms.service';
import { BdSmsMessage } from './sms-message.entity';
import { SmsSettingsService } from './sms-settings.service';
import { SmsService } from './sms.service';
import type { NotificationsPluginOptions } from './types';

const text = (en: string, bn: string) => [
    { languageCode: LanguageCode.en, value: en },
    { languageCode: LanguageCode.bn, value: bn },
];

const customerFields: CustomFieldConfig[] = [
    {
        name: 'smsOptOut',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        public: false,
        label: text('No marketing or optional SMS', 'ঐচ্ছিক SMS পাঠাবেন না'),
        description: text(
            'Only the SMS the store marks as required (e.g. order confirmed) are sent',
            'শুধু দোকানের জরুরি SMS (যেমন অর্ডার কনফার্ম) যাবে',
        ),
    },
];

const orderFields: CustomFieldConfig[] = [
    {
        name: 'trackingToken',
        type: 'string',
        length: 32,
        nullable: true,
        unique: true,
        public: false,
        readonly: true,
        label: text('Tracking link key', 'ট্র্যাকিং লিংকের কী'),
    },
];

const adminApiExtensions = gql`
    type BdSmsCount {
        messages: Int!
        "SMS parts (what the provider charges for)"
        segments: Int!
    }

    type BdSmsUsage {
        today: BdSmsCount!
        month: BdSmsCount!
        "The SMS driver: log (recorded, not sent), none (no provider yet), or the provider's code"
        provider: String!
    }

    type BdSmsMessage {
        id: ID!
        createdAt: DateTime!
        event: String!
        to: String!
        body: String!
        segments: Int!
        "queued, scheduled, sent, delivered, failed or skipped"
        status: String!
        reason: String!
        sendAfter: DateTime
        sentAt: DateTime
    }

    type BdUpdateSmsSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    extend type Query {
        bdSmsSettings: JSON!
        bdSmsUsage: BdSmsUsage!
        "The SMS of one order, newest first"
        bdSmsMessages(orderId: ID!): [BdSmsMessage!]!
    }

    extend type Mutation {
        updateBdSmsSettings(input: JSON!): BdUpdateSmsSettingsResult!
    }
`;

@Resolver()
class SmsAdminResolver {
    constructor(
        private settings: SmsSettingsService,
        private sms: SmsService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    bdSmsSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    updateBdSmsSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.settings.update(ctx, args.input);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    bdSmsUsage(@Ctx() ctx: RequestContext) {
        return this.sms.usage(ctx);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdSmsMessages(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.sms.forOrder(ctx, args.orderId);
    }
}

const releaseTask = new ScheduledTask({
    id: 'bd-release-scheduled-sms',
    description: 'Send SMS held back by quiet hours once their time has come',
    schedule: '*/5 * * * *',
    async execute({ injector }) {
        return { released: await injector.get(SmsService).releaseScheduled() };
    },
});

/**
 * Notifications (roadmap phase 10): order SMS in the customer's language, through a driver (the
 * provider is chosen later: the `log` driver records instead of sending), with an outbox and
 * retries, templates the merchant edits, quiet hours, SMS pumping caps and a usage counter.
 * Email hygiene (no placeholder addresses, no dev mailbox in production) is in vendure-config.ts.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [BdSmsMessage],
    providers: [
        { provide: NOTIFICATIONS_PLUGIN_OPTIONS, useFactory: () => NotificationsPlugin.options },
        SmsSettingsService,
        SmsService,
        OrderSmsService,
    ],
    exports: [SmsService],
    adminApiExtensions: { schema: adminApiExtensions, resolvers: [SmsAdminResolver] },
    configuration: config => {
        config.customFields.Customer = [...(config.customFields.Customer ?? []), ...customerFields];
        config.customFields.Order = [...(config.customFields.Order ?? []), ...orderFields];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), releaseTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            notifications: [
                {
                    name: 'sms',
                    readonly: true,
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        write: updateStoreSettingsPermission.Permission,
                    },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class NotificationsPlugin {
    static options: NotificationsPluginOptions;

    static init(options: NotificationsPluginOptions): Type<NotificationsPlugin> {
        NotificationsPlugin.options = options;
        return NotificationsPlugin;
    }
}

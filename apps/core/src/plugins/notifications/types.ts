import type { SmsDriver } from './sms-driver';

export interface NotificationsPluginOptions {
    /** SMS_DRIVER: `log` (development, tests: nothing is sent) or `none` (no provider yet). */
    driver: SmsDriver;
    /** STOREFRONT_URL: tracking links are `<url>/t/<token>`; without it SMS carry no link. */
    storefrontUrl?: string;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomCustomerFields {
        smsOptOut?: boolean;
    }
    interface CustomOrderFields {
        trackingToken?: string | null;
    }
}

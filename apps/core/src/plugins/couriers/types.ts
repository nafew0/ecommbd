import type { Courier } from '@ecommbd/shared';

declare module '@vendure/core/dist/service/services/history.service' {
    interface OrderHistoryEntryData {
        BD_COURIER: {
            courier: string;
            /** booked, booking-failed, status, manual, cancelled */
            event: string;
            consignmentId?: string;
            status?: string;
            outcome?: string;
            message?: string;
        };
    }
}

export interface CouriersPluginOptions {
    /** STOREFRONT_URL: where couriers send status updates (`/bd-courier/…`, proxied to the core). */
    publicUrl?: string;
    /** SECRETS_KEYRING: encrypts courier credentials and webhook secrets. */
    keyring?: string;
    /** Tests point the couriers at a mock server; never set in production. */
    baseUrls?: Partial<Record<Courier, string>>;
}

export {};

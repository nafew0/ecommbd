import type { OnlineGateway } from '@ecommbd/shared';

declare module '@vendure/core/dist/service/helpers/payment-state-machine/payment-state' {
    interface CustomPaymentStates {
        /** An online payment started but not confirmed by the gateway: not money received (phase 18). */
        Pending: never;
    }
}

declare module '@vendure/core/dist/service/helpers/order-state-machine/order-state' {
    interface CustomOrderStates {
        /** Placed and holding stock, waiting for an online payment (phase 18). */
        AwaitingPayment: never;
    }
}

declare module '@vendure/core/dist/service/services/history.service' {
    interface OrderHistoryEntryData {
        BD_ONLINE_PAYMENT: {
            attemptId: string;
            gateway: string;
            /** paid, failed, cancelled, expired, review, accepted, refunding, refunded, refundCancelled, resolved */
            event: string;
            amount?: number;
            reason?: string;
            note?: string;
        };
    }
}

/** What we keep in an online payment's metadata (`public` is shown to the shopper). */
export interface OnlinePaymentMetadata {
    kind: 'gateway';
    gateway: OnlineGateway;
    purpose: 'advance' | 'full';
    /** The first attempt's key, read when the payment becomes Pending to write the attempt row. */
    firstAttemptToken: string;
    /** Set when an attempt is confirmed. */
    paidAttemptId?: string;
    gatewayTransactionId?: string;
    public: { kind: 'gateway'; gateway: OnlineGateway; purpose: 'advance' | 'full'; payUrl: string };
}

export interface PaymentsOnlinePluginOptions {
    /** STOREFRONT_URL: the store's public address, where the gateways send shoppers back and notify us. */
    publicUrl?: string;
    /** SECRETS_KEYRING: encrypts gateway credentials. Without it they can't be saved. */
    keyring?: string;
    /** Tests point the gateways at a mock server; never set in production. */
    baseUrls?: Partial<Record<OnlineGateway, string>>;
}

export {};

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        /** Meta's browser ID (`_fbp`) and click ID (`_fbc`), the shopper's IP and browser, saved at checkout (phase 20). */
        metaFbp?: string | null;
        metaFbc?: string | null;
        metaClientIp?: string | null;
        metaUserAgent?: string | null;
    }
}

export interface MetaCapiPluginOptions {
    /** STOREFRONT_URL: the event_source_url of server events. */
    publicUrl?: string;
    /** SECRETS_KEYRING: encrypts the Conversions API tokens. */
    keyring?: string;
    /** Tests point the Graph API at a mock server; never set in production. */
    graphUrl?: string;
}

export {};

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        riskScore?: number | null;
        riskReasons?: string | null;
        otpStatus?: 'verified' | 'unverified' | null;
    }
}

export {};

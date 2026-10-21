import type { CustomFieldConfig } from '@vendure/core';

/** Not in the GraphQL API: `Order.bdRisk` shows them to staff who may see them. */
const internal = (config: CustomFieldConfig): CustomFieldConfig => ({ nullable: true, ...config, internal: true });

/** Our fields on Vendure's Order for fake-order protection (roadmap phase 11). */
export const orderFraudCustomFields: CustomFieldConfig[] = [
    internal({ name: 'riskScore', type: 'int' }),
    /** RiskReason[] as JSON. */
    internal({ name: 'riskReasons', type: 'text' }),
    /** COD verification: verified, or unverified (the shopper got no code and the store allows that). */
    internal({ name: 'otpStatus', type: 'string', length: 12 }),
];

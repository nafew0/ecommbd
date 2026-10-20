import type { VendureConfig } from '@vendure/core';

/**
 * Our own Vendure plugins: every Bangladesh-specific feature lives in one of these
 * (docs/roadmap). Listed here, not inline in vendure-config.ts, so end-to-end tests and the
 * permission audit test use exactly the same list.
 */
export const customPlugins: NonNullable<VendureConfig['plugins']> = [];

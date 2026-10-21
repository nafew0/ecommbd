import { MFS_PROVIDERS, type MfsProvider } from '@ecommbd/shared';
import { LanguageCode, PaymentMethodService, RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import {
    COD_CHECKER_CODE,
    COD_HANDLER_CODE,
    COD_METHOD_CODE,
    MFS_CHECKER_CODE,
    MFS_HANDLER_CODE,
    MFS_METHOD_CODES,
    verifyPaymentPermission,
} from './constants';

const MFS_NAMES: Record<MfsProvider, { en: string; bn: string }> = {
    bkash: { en: 'bKash', bn: 'বিকাশ' },
    nagad: { en: 'Nagad', bn: 'নগদ' },
    rocket: { en: 'Rocket', bn: 'রকেট' },
};

/**
 * Store defaults (phase 08): Cash on delivery, and bKash, Nagad and Rocket "Send Money". Whether
 * each is offered comes from the payment settings (COD on; mobile banking once the merchant enters
 * a number), so the methods themselves never need editing.
 */
export const paymentMethodsStep: StoreDefaultsStep = {
    id: 'payment-methods',
    description: 'Payment methods: Cash on delivery, bKash, Nagad and Rocket (Send Money)',
    async run({ ctx, injector }) {
        const service = injector.get(PaymentMethodService);
        const existing = await service.findAll(ctx, { take: 100 });
        const codes = new Set(existing.items.map(method => method.code));
        const created: string[] = [];
        if (!codes.has(COD_METHOD_CODE)) {
            await service.create(ctx, {
                code: COD_METHOD_CODE,
                enabled: true,
                handler: { code: COD_HANDLER_CODE, arguments: [] },
                checker: { code: COD_CHECKER_CODE, arguments: [] },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Cash on delivery',
                        description: 'Pay the delivery person when your order arrives',
                    },
                    {
                        languageCode: LanguageCode.bn,
                        name: 'ক্যাশ অন ডেলিভারি',
                        description: 'পণ্য হাতে পেয়ে ডেলিভারিম্যানকে টাকা দিন',
                    },
                ],
            });
            created.push(COD_METHOD_CODE);
        }
        for (const provider of MFS_PROVIDERS) {
            const code = MFS_METHOD_CODES[provider];
            if (codes.has(code)) {
                continue;
            }
            const args = [{ name: 'provider', value: provider }];
            const names = MFS_NAMES[provider];
            await service.create(ctx, {
                code,
                enabled: true,
                handler: { code: MFS_HANDLER_CODE, arguments: args },
                checker: { code: MFS_CHECKER_CODE, arguments: args },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: `${names.en} (Send Money)`,
                        description: `Send the money by ${names.en}, then enter the transaction ID`,
                    },
                    {
                        languageCode: LanguageCode.bn,
                        name: `${names.bn} (সেন্ড মানি)`,
                        description: `${names.bn} দিয়ে টাকা পাঠিয়ে ট্রানজেকশন আইডি লিখুন`,
                    },
                ],
            });
            created.push(code);
        }
        return created.length ? [`payment methods created: ${created.join(', ')}`] : [];
    },
};

/** Who may verify payments and record refunds, among the default roles (phase 02). */
const GRANTS: Record<string, string[]> = {
    owner: [verifyPaymentPermission.Permission],
    manager: [verifyPaymentPermission.Permission],
};

export const paymentPermissionsStep: StoreDefaultsStep = {
    id: 'payment-permissions',
    description: 'VerifyPayment for the Owner and Manager roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        for (const role of roles.items) {
            const missing = (GRANTS[role.code] ?? []).filter(p => !role.permissions.includes(p as never));
            if (missing.length) {
                await roleService.update(ctx, {
                    id: role.id,
                    permissions: [...role.permissions, ...missing] as never,
                });
                notes.push(`${role.code}: ${missing.join(', ')}`);
            }
        }
        return notes;
    },
};

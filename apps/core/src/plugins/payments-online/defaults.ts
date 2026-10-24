import { ONLINE_GATEWAYS, type OnlineGateway } from '@ecommbd/shared';
import { LanguageCode, PaymentMethodService, RoleService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import {
    managePaymentsPermission,
    ONLINE_CHECKER_CODE,
    ONLINE_HANDLER_CODE,
    ONLINE_METHOD_CODES,
} from './constants';

const NAMES: Record<OnlineGateway, { en: [string, string]; bn: [string, string] }> = {
    sslcommerz: {
        en: ['Card, mobile banking or net banking', 'Pay securely through SSLCommerz'],
        bn: ['কার্ড, মোবাইল ব্যাংকিং বা নেট ব্যাংকিং', 'SSLCommerz দিয়ে নিরাপদে পেমেন্ট করুন'],
    },
    bkash: {
        en: ['bKash', 'Pay with your bKash account'],
        bn: ['বিকাশ', 'আপনার বিকাশ অ্যাকাউন্ট দিয়ে পেমেন্ট করুন'],
    },
};

/**
 * Store defaults (phase 18): an SSLCommerz and a bKash payment method. They're offered only once
 * the merchant turns the gateway on and saves its credentials (the eligibility checker), so the
 * methods themselves never need editing.
 */
export const onlineMethodsStep: StoreDefaultsStep = {
    id: 'online-payment-methods',
    description: 'Payment methods: SSLCommerz and bKash (online)',
    async run({ ctx, injector }) {
        const service = injector.get(PaymentMethodService);
        const existing = await service.findAll(ctx, { take: 100 });
        const codes = new Set(existing.items.map(method => method.code));
        const created: string[] = [];
        for (const gateway of ONLINE_GATEWAYS) {
            const code = ONLINE_METHOD_CODES[gateway];
            if (codes.has(code)) continue;
            const args = [{ name: 'gateway', value: gateway }];
            const names = NAMES[gateway];
            await service.create(ctx, {
                code,
                enabled: true,
                handler: { code: ONLINE_HANDLER_CODE, arguments: args },
                checker: { code: ONLINE_CHECKER_CODE, arguments: args },
                translations: [
                    { languageCode: LanguageCode.en, name: names.en[0], description: names.en[1] },
                    { languageCode: LanguageCode.bn, name: names.bn[0], description: names.bn[1] },
                ],
            });
            created.push(code);
        }
        return created.length ? [`payment methods created: ${created.join(', ')}`] : [];
    },
};

export const onlinePermissionsStep: StoreDefaultsStep = {
    id: 'online-payment-permissions',
    description: 'ManagePayments for the Owner role',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const owner = roles.items.find(role => role.code === 'owner');
        const permission = managePaymentsPermission.Permission;
        if (!owner || owner.permissions.includes(permission as never)) return [];
        await roleService.update(ctx, {
            id: owner.id,
            permissions: [...owner.permissions, permission] as never,
        });
        return [`owner: ${permission}`];
    },
};

import { DELIVERY_METHODS, type DeliveryMethod } from '@ecommbd/shared';
import { LanguageCode, manualFulfillmentHandler, ShippingMethodService } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { DELIVERY_CALCULATOR_CODE, DELIVERY_CHECKER_CODE, DELIVERY_METHOD_CODES } from './constants';

const NAMES: Record<
    DeliveryMethod,
    { en: string; bn: string; descriptionEn: string; descriptionBn: string }
> = {
    standard: {
        en: 'Standard delivery',
        bn: 'সাধারণ ডেলিভারি',
        descriptionEn: 'Delivered to your address',
        descriptionBn: 'আপনার ঠিকানায় পৌঁছে দেওয়া হবে',
    },
    express: {
        en: 'Express delivery',
        bn: 'এক্সপ্রেস ডেলিভারি',
        descriptionEn: 'Faster delivery',
        descriptionBn: 'দ্রুত ডেলিভারি',
    },
    pickup: {
        en: 'Store pickup',
        bn: 'দোকান থেকে সংগ্রহ',
        descriptionEn: 'Collect it from our shop',
        descriptionBn: 'আমাদের দোকান থেকে নিয়ে যান',
    },
};

/**
 * Store defaults (phase 07): Standard, Express and Store pickup. Their charges, and whether Express
 * and pickup are offered, come from the delivery settings (Express and pickup start off), so the
 * methods themselves never need editing.
 */
export const deliveryMethodsStep: StoreDefaultsStep = {
    id: 'delivery-methods',
    description: 'Delivery methods: Standard, Express and Store pickup, priced by the delivery settings',
    async run({ ctx, injector }) {
        const service = injector.get(ShippingMethodService);
        const existing = await service.findAll(ctx, { take: 100 });
        const codes = new Set(existing.items.map(method => method.code));
        const created: string[] = [];
        for (const method of DELIVERY_METHODS) {
            const code = DELIVERY_METHOD_CODES[method];
            if (codes.has(code)) {
                continue;
            }
            const names = NAMES[method];
            const args = [{ name: 'method', value: method }];
            await service.create(ctx, {
                code,
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: { code: DELIVERY_CHECKER_CODE, arguments: args },
                calculator: { code: DELIVERY_CALCULATOR_CODE, arguments: args },
                translations: [
                    { languageCode: LanguageCode.en, name: names.en, description: names.descriptionEn },
                    { languageCode: LanguageCode.bn, name: names.bn, description: names.descriptionBn },
                ],
            });
            created.push(code);
        }
        return created.length ? [`delivery methods created: ${created.join(', ')}`] : [];
    },
};

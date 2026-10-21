import { DELIVERY_METHODS, type DeliveryMethod } from '@ecommbd/shared';
import { type Injector, LanguageCode, ShippingCalculator, ShippingEligibilityChecker } from '@vendure/core';
import { DELIVERY_CALCULATOR_CODE, DELIVERY_CHECKER_CODE } from './constants';
import { DeliveryService } from './delivery.service';

const methodArg = {
    method: {
        type: 'string' as const,
        defaultValue: 'standard',
        ui: { component: 'select-form-input', options: DELIVERY_METHODS.map(value => ({ value })) },
        label: [
            { languageCode: LanguageCode.en, value: 'Delivery method' },
            { languageCode: LanguageCode.bn, value: 'ডেলিভারির ধরন' },
        ],
    },
};

const asMethod = (value: string): DeliveryMethod =>
    (DELIVERY_METHODS as readonly string[]).includes(value) ? (value as DeliveryMethod) : 'standard';

let delivery: DeliveryService | undefined;
const init = (injector: Injector) => {
    delivery = injector.get(DeliveryService);
};

/**
 * Whether a delivery method can deliver this order: the method is on, the address has a usable
 * district, it's in the store's coverage, and the order isn't too heavy. Rates come from the
 * store's delivery settings (merchant admin), not from these arguments.
 */
export const deliveryEligibilityChecker = new ShippingEligibilityChecker({
    code: DELIVERY_CHECKER_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Bangladesh delivery settings' },
        { languageCode: LanguageCode.bn, value: 'বাংলাদেশ ডেলিভারি সেটিংস' },
    ],
    args: methodArg,
    init,
    check: async (ctx, order, args) => (await delivery!.quote(ctx, order, asMethod(args.method))).ok,
});

/** The delivery charge from the store's delivery settings (zone, overrides, products, weight, free delivery). */
export const deliveryRateCalculator = new ShippingCalculator({
    code: DELIVERY_CALCULATOR_CODE,
    description: [
        { languageCode: LanguageCode.en, value: 'Bangladesh delivery charges' },
        { languageCode: LanguageCode.bn, value: 'বাংলাদেশ ডেলিভারি চার্জ' },
    ],
    args: methodArg,
    init,
    calculate: async (ctx, order, args) => {
        const quote = await delivery!.quote(ctx, order, asMethod(args.method));
        if (!quote.ok) {
            // The checker already refused this method; returning undefined keeps it out of the list.
            return undefined;
        }
        // A charge staff typed for this order (manual orders, edits) wins over the rules.
        const override = order.customFields?.deliveryChargeOverride;
        if (typeof override === 'number') {
            return { price: override, priceIncludesTax: true, taxRate: 0, metadata: { override: true } };
        }
        return {
            price: quote.price,
            // Delivery charges are typed as the shopper pays them; there's no VAT on them (0% rate).
            priceIncludesTax: true,
            taxRate: 0,
            metadata: {
                free: quote.free,
                base: quote.base,
                weightSurcharge: quote.weightSurcharge,
                productSurcharge: quote.productSurcharge,
            },
        };
    },
});

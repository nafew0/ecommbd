import { readSalesSettings } from '@ecommbd/sections';
import {
    LanguageCode,
    PromotionCondition,
    PromotionOrderAction,
    TransactionalConnection,
} from '@vendure/core';
import { OFFER_ACTION_CODE, OFFER_CONDITION_CODE } from './constants';
import { BdSalesPage } from './entities';
import { offerDiscount } from './offer';

let connection: TransactionalConnection | undefined;

/**
 * The order came from an active sales page whose packs or add-on apply to it. Passes the discount
 * to the action (worked out once, from the page's current settings).
 */
export const salesPageOfferCondition = new PromotionCondition({
    code: OFFER_CONDITION_CODE,
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Ordered on a sales page, with one of its packs or its add-on',
        },
        {
            languageCode: LanguageCode.bn,
            value: 'সেলস পেজ থেকে অর্ডার, তার কোনো প্যাক বা সাথে নেওয়ার অফারসহ',
        },
    ],
    args: {},
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    async check(ctx, order) {
        const pageId = (order.customFields as { salesPageId?: string | null }).salesPageId;
        if (!pageId || !connection || !/^\d+$/.test(pageId)) return false;
        const page = await connection.getRepository(ctx, BdSalesPage).findOne({ where: { id: pageId } });
        if (!page?.active || !page.productId) return false;
        const discount = offerDiscount(
            { productId: String(page.productId), settings: readSalesSettings(page.settings) },
            order.lines.map(line => ({
                productId: String(line.productVariant.productId),
                variantId: String(line.productVariantId),
                quantity: line.quantity,
                unitPrice: line.unitPriceWithTax,
            })),
        );
        return discount > 0 ? { discount } : false;
    },
});

export const salesPageOfferAction = new PromotionOrderAction({
    code: OFFER_ACTION_CODE,
    description: [
        { languageCode: LanguageCode.en, value: "The sales page's pack and add-on prices" },
        { languageCode: LanguageCode.bn, value: 'সেলস পেজের প্যাক আর সাথে নেওয়ার অফারের দাম' },
    ],
    args: {},
    conditions: [salesPageOfferCondition],
    execute(_ctx, order, _args, state) {
        const discount = Number(
            (state[OFFER_CONDITION_CODE] as { discount?: number } | undefined)?.discount ?? 0,
        );
        return -Math.min(Math.max(0, discount), order.subTotalWithTax);
    },
});

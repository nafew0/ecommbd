import { PromotionService, TransactionalConnection, Promotion } from '@vendure/core';
import type { StoreDefaultsStep } from '../bd-core';
import { OFFER_ACTION_CODE, OFFER_CONDITION_CODE, OFFER_PROMOTION_NAME } from './constants';

/**
 * Store defaults (phase 16): the automatic "Sales page offer" promotion that prices sales page packs
 * and add-ons (offer-promotion.ts). Made once; a merchant who switches it off has switched off
 * sales page offers, and it's left that way.
 */
export const salesPageOfferStep: StoreDefaultsStep = {
    id: 'sales-page-offer-promotion',
    description: 'The automatic "Sales page offer" promotion for sales page packs and add-ons',
    async run({ ctx, injector }) {
        const promotions = await injector
            .get(TransactionalConnection)
            .getRepository(ctx, Promotion)
            .find({ relations: ['translations'] });
        const exists = promotions.some(promotion =>
            promotion.conditions.some(condition => condition.code === OFFER_CONDITION_CODE),
        );
        if (exists) return [];
        await injector.get(PromotionService).createPromotion(ctx, {
            enabled: true,
            conditions: [{ code: OFFER_CONDITION_CODE, arguments: [] }],
            actions: [{ code: OFFER_ACTION_CODE, arguments: [] }],
            translations: [
                { languageCode: 'bn' as never, name: 'সেলস পেজের অফার', description: '' },
                { languageCode: 'en' as never, name: OFFER_PROMOTION_NAME, description: '' },
            ],
        });
        return [`promotion "${OFFER_PROMOTION_NAME}" created`];
    },
};

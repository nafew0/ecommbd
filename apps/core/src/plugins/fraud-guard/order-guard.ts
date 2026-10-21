import { Order, type OrderProcess, TransactionalConnection } from '@vendure/core';
import { BlockListService } from './block-list.service';
import { FraudSettingsService } from './fraud-settings.service';

const MINUTE = 60_000;

/**
 * Storefront orders only (staff decide for themselves): before payment, a blocked phone or IP
 * sees a polite "not available", never "you are blocked"; too many orders from one phone in a day
 * are refused; and, when the store turns it on, a phone can't order again for N minutes after an
 * order, seeing the merchant's own message (the storefront adds a WhatsApp button).
 */
export function createFraudGuard(): OrderProcess<never> {
    let blockList: BlockListService;
    let settings: FraudSettingsService;
    let connection: TransactionalConnection;
    return {
        init(injector) {
            blockList = injector.get(BlockListService);
            settings = injector.get(FraudSettingsService);
            connection = injector.get(TransactionalConnection);
        },
        async onTransitionStart(_fromState, toState, { ctx, order }) {
            if (toState !== 'ArrangingPayment' || ctx.apiType !== 'shop') return;
            const phone = order.customer?.customFields?.phone;
            if (
                (await blockList.find(ctx, 'phone', phone)) ||
                (await blockList.find(ctx, 'ip', ctx.req?.ip))
            ) {
                return 'message.fraud-guard.unavailable';
            }
            const customerId = order.customerId ?? order.customer?.id;
            if (!customerId) return;
            const { velocity } = await settings.get(ctx);
            const [row] = await connection.getRepository(ctx, Order).query(
                `SELECT COUNT(*) FILTER (WHERE "orderPlacedAt" >= $3)::int AS "today", MAX("orderPlacedAt") AS "last"
                 FROM "order" WHERE "customerId" = $1 AND "id" <> $2 AND "orderPlacedAt" IS NOT NULL
                   AND "state" <> 'Cancelled'`,
                [customerId, order.id, new Date(Date.now() - 24 * 60 * MINUTE)],
            );
            const recent = row as { today: number; last: Date | null };
            if (velocity.duplicateOrderMinutes && recent.last) {
                const until = new Date(recent.last).getTime() + velocity.duplicateOrderMinutes * MINUTE;
                if (until > Date.now()) {
                    return velocity.duplicateOrderMessage[ctx.languageCode === 'en' ? 'en' : 'bn'];
                }
            }
            if (velocity.maxOrdersPerPhonePerDay && recent.today >= velocity.maxOrdersPerPhonePerDay) {
                return 'message.fraud-guard.too-many';
            }
        },
    };
}

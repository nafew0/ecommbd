import { OTHER_THANA_ID } from '@ecommbd/bd-geo';
import { assessRisk, type RiskAssessment, type RiskReason } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type ID,
    Order,
    OrderService,
    type RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';
import { FraudSettingsService } from './fraud-settings.service';

const DAY = 24 * 60 * 60_000;

/** The order's items as "variant:quantity,…", to spot the same cart ordered twice. */
const cartOf = (order: Order) =>
    (order.lines ?? [])
        .filter(line => line.quantity > 0)
        .map(line => `${line.productVariantId}:${line.quantity}`)
        .sort()
        .join(',');

/**
 * The own-store risk score of an order (roadmap phase 11), from this customer's (that is, this
 * phone's) orders here, how fast it orders, and how real the name and address look. Worked out
 * when needed (payment rules, verification codes) and kept on the order when it's placed, for the
 * confirmation queue.
 */
@Injectable()
export class RiskService {
    constructor(
        private connection: TransactionalConnection,
        private requestCache: RequestContextCacheService,
        private settings: FraudSettingsService,
        private orders: OrderService,
    ) {}

    async assess(ctx: RequestContext, order: Order): Promise<RiskAssessment> {
        const full = await this.withRelations(ctx, order);
        return this.requestCache.get(ctx, `fraudGuard.risk.${full.id}:${cartOf(full)}`, () => this.work(ctx, full));
    }

    /** Some callers have the order without its lines or customer. */
    async withRelations(ctx: RequestContext, order: Order): Promise<Order> {
        if (order.lines && order.customer !== undefined && order.shippingAddress) return order;
        return (await this.orders.findOne(ctx, order.id)) ?? order;
    }

    async isRisky(ctx: RequestContext, order: Order): Promise<boolean> {
        const [risk, settings] = await Promise.all([this.assess(ctx, order), this.settings.get(ctx)]);
        return risk.score >= settings.risk.riskyScore;
    }

    /** Kept on the placed order: the queue shows it without working it out again. */
    async store(ctx: RequestContext, order: Order): Promise<void> {
        const risk = await this.work(ctx, await this.withRelations(ctx, order));
        await this.connection.getRepository(ctx, Order).update(order.id, {
            customFields: { riskScore: risk.score, riskReasons: JSON.stringify(risk.reasons) },
        });
    }

    /** What was kept on the order; null for orders placed before phase 11. */
    stored(order: Order): RiskAssessment | null {
        const { riskScore, riskReasons } = order.customFields;
        if (riskScore === null || riskScore === undefined) return null;
        let reasons: RiskReason[] = [];
        try {
            reasons = JSON.parse(riskReasons ?? '[]') as RiskReason[];
        } catch {
            // A damaged value shows the score without reasons.
        }
        return { score: riskScore, level: riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low', reasons };
    }

    private async work(ctx: RequestContext, order: Order): Promise<RiskAssessment> {
        const address = order.shippingAddress;
        const fields = (address?.customFields ?? {}) as { thanaId?: string };
        const history = await this.history(ctx, order.customerId ?? order.customer?.id, order.id, cartOf(order));
        return assessRisk({
            ...history,
            street: address?.streetLine1 ?? '',
            otherThana: fields.thanaId === OTHER_THANA_ID,
            name: address?.fullName || order.customer?.firstName || '',
        });
    }

    private async history(ctx: RequestContext, customerId: ID | undefined, orderId: ID, cart: string) {
        const none = { delivered: 0, returned: 0, fake: 0, ordersLast24h: 0, duplicateCart: false };
        if (!customerId) return none;
        const repository = this.connection.getRepository(ctx, Order);
        const since = new Date(Date.now() - DAY);
        const [row] = await repository.query(
            `SELECT
                COUNT(*) FILTER (WHERE o."state" = 'Delivered')::int AS delivered,
                COUNT(*) FILTER (WHERE o."state" = 'Returned')::int AS returned,
                COUNT(*) FILTER (WHERE o."state" = 'Cancelled' AND o."customFieldsCancelreason" = 'fake')::int AS fake,
                COUNT(*) FILTER (WHERE o."orderPlacedAt" >= $3)::int AS "ordersLast24h"
             FROM "order" o
             WHERE o."customerId" = $1 AND o."id" <> $2 AND o."orderPlacedAt" IS NOT NULL`,
            [customerId, orderId, since],
        );
        const recent: Array<{ items: string[] }> = await repository.query(
            `SELECT array_agg(l."productVariantId" || ':' || l."quantity") AS items
             FROM "order" o JOIN "order_line" l ON l."orderId" = o."id" AND l."quantity" > 0
             WHERE o."customerId" = $1 AND o."id" <> $2 AND o."orderPlacedAt" >= $3
             GROUP BY o."id"`,
            [customerId, orderId, since],
        );
        return {
            ...none,
            ...(row as Partial<typeof none> | undefined),
            duplicateCart: Boolean(cart) && recent.some(other => [...other.items].sort().join(',') === cart),
        };
    }
}

import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
    Customer,
    CustomerEvent,
    EventBus,
    type ID,
    Logger,
    OrderStateTransitionEvent,
    TransactionalConnection,
} from '@vendure/core';
import { filter } from 'rxjs/operators';
import { loggerCtx } from './constants';
import { PhoneCustomerService } from './phone-customer.service';

/** Postgres int columns hold at most this; no customer spends ৳2 crore, but never overflow. */
const MAX_INT = 2_147_483_647;

interface StatsRow {
    orderCount: number;
    deliveredCount: number;
    returnedCount: number;
    cancelledCount: number;
    totalSpent: string;
    lastOrderAt: Date | null;
}

/**
 * Keeps each customer's order stats current (roadmap phase 03). They're recomputed from the orders
 * table whenever a placed order changes state, rather than incremented, so they stay correct after
 * retried or out-of-order events, and they include orders imported from WooCommerce. Total spent counts delivered orders: for
 * cash on delivery that's when the money is received.
 */
@Injectable()
export class CustomerStatsService implements OnApplicationBootstrap {
    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
        private phoneCustomers: PhoneCustomerService,
    ) {}

    onApplicationBootstrap() {
        this.eventBus
            .ofType(OrderStateTransitionEvent)
            .pipe(filter(event => !event.order.active && event.order.customerId != null))
            .subscribe(event => void this.refreshSafely(event.order.customerId as ID));
        this.eventBus
            .ofType(CustomerEvent)
            .pipe(filter(event => event.type === 'deleted'))
            .subscribe(event => void this.phoneCustomers.releasePhone(event.entity.id));
    }

    async refresh(customerId: ID): Promise<void> {
        // Live orders, plus the orders imported from WooCommerce (woo_legacy_order, read-only
        // history) so a migrated customer's counts include their old store's orders. A legacy
        // order already turned into a live one is counted once, as the live order.
        const [row] = (await this.connection.rawConnection.query(
            `WITH orders AS (
                SELECT "state", ("subTotalWithTax" + "shippingWithTax")::bigint AS "spent", "orderPlacedAt" AS "placedAt"
                FROM "order"
                WHERE "customerId" = $1 AND "orderPlacedAt" IS NOT NULL
                UNION ALL
                SELECT CASE
                           WHEN "status" = 'completed' THEN 'Delivered'
                           WHEN "status" IN ('refunded', 'returned') THEN 'Returned'
                           WHEN "status" IN ('cancelled', 'failed') THEN 'Cancelled'
                           ELSE "status"
                       END,
                       CASE WHEN "currency" = 'BDT' THEN "total" - "refunded" ELSE 0 END,
                       "placedAt"
                FROM "woo_legacy_order"
                WHERE "customerId" = $1 AND "liveOrderId" IS NULL
                    AND "status" NOT IN ('checkout-draft', 'trash')
            )
            SELECT COUNT(*)::int AS "orderCount",
                COUNT(*) FILTER (WHERE "state" = 'Delivered')::int AS "deliveredCount",
                COUNT(*) FILTER (WHERE "state" = 'Returned')::int AS "returnedCount",
                COUNT(*) FILTER (WHERE "state" = 'Cancelled')::int AS "cancelledCount",
                COALESCE(SUM("spent") FILTER (WHERE "state" = 'Delivered'), 0)::text AS "totalSpent",
                MAX("placedAt") AS "lastOrderAt"
             FROM orders`,
            [customerId],
        )) as StatsRow[];
        await this.connection.rawConnection.getRepository(Customer).update(customerId, {
            customFields: {
                orderCount: row!.orderCount,
                deliveredCount: row!.deliveredCount,
                returnedCount: row!.returnedCount,
                cancelledCount: row!.cancelledCount,
                totalSpent: Math.min(Number(row!.totalSpent), MAX_INT),
                lastOrderAt: row!.lastOrderAt,
            },
        });
    }

    private async refreshSafely(customerId: ID) {
        try {
            await this.refresh(customerId);
        } catch (error) {
            Logger.error(`Could not update the stats of customer ${customerId}: ${String(error)}`, loggerCtx);
        }
    }
}

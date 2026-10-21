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
 * retried or out-of-order events and imported history. Total spent counts delivered orders: for
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
        const [row] = (await this.connection.rawConnection.query(
            `SELECT COUNT(*)::int AS "orderCount",
                COUNT(*) FILTER (WHERE "state" = 'Delivered')::int AS "deliveredCount",
                COUNT(*) FILTER (WHERE "state" = 'Returned')::int AS "returnedCount",
                COUNT(*) FILTER (WHERE "state" = 'Cancelled')::int AS "cancelledCount",
                COALESCE(SUM("subTotalWithTax" + "shippingWithTax") FILTER (WHERE "state" = 'Delivered'), 0)::text
                    AS "totalSpent",
                MAX("orderPlacedAt") AS "lastOrderAt"
             FROM "order"
             WHERE "customerId" = $1 AND "orderPlacedAt" IS NOT NULL`,
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

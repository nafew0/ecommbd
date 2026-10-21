import {
    BD_ORDER_STATUSES,
    type BdOrderStatus,
    banglaToAsciiDigits,
    bdStatusOf,
    cleanText,
    endOfDhakaDay,
    fromDhaka,
    normalizeOrderNumberSearch,
    startOfDhakaDay,
    vendureStatesOf,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type ID,
    Order,
    type PaginatedList,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Brackets, In, type SelectQueryBuilder } from 'typeorm';

export interface OrderListFilters {
    status?: string | null;
    /** Phone digits (any part; Bangla digits too), an order number (#1001, MF-1001) or a name. */
    search?: string | null;
    /** Dhaka calendar days, `YYYY-MM-DD`, both inclusive. */
    dateFrom?: string | null;
    dateTo?: string | null;
    districtId?: string | null;
    /** cod, advance or prepaid */
    paymentType?: string | null;
}

export interface Page {
    skip?: number | null;
    take?: number | null;
}

export interface OrderStats {
    /** The Dhaka day these figures are for: 00:00 Dhaka time, as UTC. */
    dayStart: Date;
    todayOrders: number;
    /** Null without the ReadSalesFigures permission. */
    todaySales: number | null;
    waitingConfirmation: number;
    confirmedNotPacked: number;
}

const MAX_TAKE = 100;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, char => `\\${char}`);

/** The shopper-typed address and phone live in the order's JSON column. */
const SHIPPING = `"order"."shippingAddress"::jsonb`;
/** Money received: settled payments. */
const SETTLED = `(SELECT COALESCE(SUM(p."amount"), 0) FROM "payment" p WHERE p."orderId" = "order"."id" AND p."state" = 'Settled')`;
const TOTAL = `("order"."subTotalWithTax" + "order"."shippingWithTax")`;

const PAGE_RELATIONS = ['customer', 'lines', 'lines.productVariant', 'shippingLines', 'payments'];

/**
 * The admin's order lists (roadmap phase 04): all orders with status tabs, filters and search; the
 * confirmation queue; and the home widgets. Lists first find one page of IDs with the filters
 * (indexed columns only for the queue), then load those orders with their lines.
 */
@Injectable()
export class OrderListService {
    constructor(private connection: TransactionalConnection) {}

    async list(ctx: RequestContext, filters: OrderListFilters, page: Page): Promise<PaginatedList<Order>> {
        const qb = this.placedOrders(ctx);
        this.applyFilters(qb, filters);
        if (filters.status) {
            const status = filters.status as BdOrderStatus;
            qb.andWhere('order.state IN (:...states)', {
                states: BD_ORDER_STATUSES.includes(status) ? vendureStatesOf(status) : ['-'],
            });
        }
        qb.orderBy('order.orderPlacedAt', 'DESC').addOrderBy('order.id', 'DESC');
        return this.page(ctx, qb, page);
    }

    /** How many orders each status tab has, with the same filters as the list. */
    async counts(
        ctx: RequestContext,
        filters: OrderListFilters,
    ): Promise<Array<{ status: string; count: number }>> {
        const qb = this.placedOrders(ctx).select('order.state', 'state').addSelect('COUNT(*)', 'count');
        this.applyFilters(qb, filters);
        const rows = await qb.groupBy('order.state').getRawMany<{ state: string; count: string }>();
        const totals = new Map<string, number>();
        for (const row of rows) {
            const status = bdStatusOf(row.state);
            if (status) {
                totals.set(status, (totals.get(status) ?? 0) + Number(row.count));
            }
        }
        return BD_ORDER_STATUSES.map(status => ({ status, count: totals.get(status) ?? 0 }));
    }

    /**
     * New orders waiting for a call, oldest (or longest unanswered) first. Snoozed ("call later")
     * orders are left out until their time comes; `snoozed` lists only them. Imported orders never
     * enter the queue.
     */
    async queue(
        ctx: RequestContext,
        options: Page & { snoozed?: boolean | null },
    ): Promise<PaginatedList<Order>> {
        const qb = this.placedOrders(ctx)
            .andWhere('order.state IN (:...states)', { states: vendureStatesOf('new') })
            .andWhere('order.customFields.imported = false')
            .andWhere(
                options.snoozed
                    ? 'order.customFields.confirmQueueAt > :now'
                    : 'order.customFields.confirmQueueAt <= :now',
                { now: new Date() },
            )
            .orderBy('order.customFields.confirmQueueAt', 'ASC')
            .addOrderBy('order.id', 'ASC');
        return this.page(ctx, qb, options);
    }

    /**
     * Home widgets for one Dhaka day (default today): orders placed and not cancelled, their sales,
     * and the work waiting. An order at 23:59 Dhaka time counts for that day, though it's 17:59 UTC.
     */
    async stats(
        ctx: RequestContext,
        date: string | null | undefined,
        canSeeSales: boolean,
    ): Promise<OrderStats> {
        const dayStart = date ? dhakaDayStart(date) : startOfDhakaDay(new Date());
        const dayEnd = endOfDhakaDay(dayStart);
        const today = await this.placedOrders(ctx)
            .select('COUNT(*)', 'orders')
            .addSelect(`COALESCE(SUM(${TOTAL}), 0)`, 'sales')
            .andWhere('order.orderPlacedAt >= :dayStart AND order.orderPlacedAt < :dayEnd', {
                dayStart,
                dayEnd,
            })
            .andWhere("order.state != 'Cancelled'")
            .getRawOne<{ orders: string; sales: string }>();
        const waiting = await this.placedOrders(ctx)
            .andWhere('order.state IN (:...states)', { states: vendureStatesOf('new') })
            .andWhere('order.customFields.imported = false')
            .getCount();
        const confirmed = await this.placedOrders(ctx).andWhere("order.state = 'Confirmed'").getCount();
        return {
            dayStart,
            todayOrders: Number(today?.orders ?? 0),
            todaySales: canSeeSales ? Number(today?.sales ?? 0) : null,
            waitingConfirmation: waiting,
            confirmedNotPacked: confirmed,
        };
    }

    /** Placed orders in this channel (carts and drafts have no orderPlacedAt). */
    private placedOrders(ctx: RequestContext): SelectQueryBuilder<Order> {
        return this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('order.orderPlacedAt IS NOT NULL');
    }

    private applyFilters(qb: SelectQueryBuilder<Order>, filters: OrderListFilters) {
        if (filters.dateFrom) {
            qb.andWhere('order.orderPlacedAt >= :dateFrom', { dateFrom: dhakaDayStart(filters.dateFrom) });
        }
        if (filters.dateTo) {
            qb.andWhere('order.orderPlacedAt < :dateTo', {
                dateTo: endOfDhakaDay(dhakaDayStart(filters.dateTo)),
            });
        }
        if (filters.districtId) {
            qb.andWhere(`(${SHIPPING} #>> '{customFields,districtId}') = :districtId`, {
                districtId: filters.districtId,
            });
        }
        if (filters.paymentType === 'cod') {
            qb.andWhere(`${SETTLED} = 0`);
        } else if (filters.paymentType === 'advance') {
            qb.andWhere(`${SETTLED} > 0 AND ${SETTLED} < ${TOTAL}`);
        } else if (filters.paymentType === 'prepaid') {
            qb.andWhere(`${SETTLED} > 0 AND ${SETTLED} >= ${TOTAL}`);
        }
        const term = cleanText(filters.search ?? '');
        if (!term) {
            return;
        }
        const number = normalizeOrderNumberSearch(term);
        const digits = banglaToAsciiDigits(term).replace(/[\s\-().+#]/g, '');
        const like = `%${escapeLike(term)}%`;
        qb.andWhere(
            new Brackets(where => {
                where
                    .where(`(${SHIPPING} ->> 'fullName') ILIKE :like`, { like })
                    .orWhere(
                        `order.customerId IN (SELECT c."id" FROM "customer" c WHERE (c."firstName" || ' ' || c."lastName") ILIKE :like)`,
                    );
                if (number) {
                    where
                        .orWhere('order.customFields.orderNumber = :number', { number })
                        .orWhere('order.customFields.orderNumber LIKE :numberSuffix', {
                            numberSuffix: `%-${number}`,
                        });
                }
                if (/^\d{3,}$/.test(digits)) {
                    where
                        .orWhere(`(${SHIPPING} ->> 'phoneNumber') LIKE :digits`, { digits: `%${digits}%` })
                        .orWhere(
                            `order.customerId IN (SELECT c."id" FROM "customer" c WHERE c."customFieldsPhone" LIKE :digits OR c."customFieldsAlternatephone" LIKE :digits)`,
                        );
                }
            }),
        );
    }

    /** One page of IDs from the filtered query, then those orders with their lines and payments. */
    private async page(
        ctx: RequestContext,
        qb: SelectQueryBuilder<Order>,
        page: Page,
    ): Promise<PaginatedList<Order>> {
        const take = Math.min(page.take ?? 25, MAX_TAKE);
        const [rows, totalItems] = await Promise.all([
            qb
                .clone()
                .select('order.id', 'id')
                .offset(page.skip ?? 0)
                .limit(take)
                .getRawMany<{ id: ID }>(),
            qb.clone().getCount(),
        ]);
        const ids = rows.map(row => row.id);
        if (!ids.length) {
            return { items: [], totalItems };
        }
        const orders = await this.connection
            .getRepository(ctx, Order)
            .find({ where: { id: In(ids) }, relations: PAGE_RELATIONS });
        const byId = new Map(orders.map(order => [String(order.id), order]));
        return {
            items: ids.map(id => byId.get(String(id))).filter((order): order is Order => !!order),
            totalItems,
        };
    }
}

/** `2026-10-21` (a Dhaka calendar day) → 00:00 Dhaka time that day, as UTC. */
function dhakaDayStart(date: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) {
        throw new UserInputError('error.bd-orders.invalid-date');
    }
    return fromDhaka(Number(match[1]), Number(match[2]), Number(match[3]));
}

import { bdPaymentType, bdStatusOf, LIVE_BOOKING_STATUSES, orderProfit, profitCountState, type OrderProfit } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    type ID,
    Fulfillment,
    Order,
    OrderLine,
    OrderService,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';
import { settledAmount } from '../bd-orders';
import { BdCourierBooking } from '../couriers/entities';
import { COD_FEE_SKU } from '../payments-bd/constants';
import { ONLINE_HANDLER_CODE } from '../payments-online/constants';
import { PROFIT_BATCH } from './constants';
import { CostSettingsService } from './cost-settings.service';

export interface ProfitLineView {
    orderLineId: ID;
    name: string;
    deliveredQuantity: number | null;
    unitCost: number | null;
    belowCost: boolean;
}

export interface OrderProfitView extends OrderProfit {
    orderId: ID;
    lines: ProfitLineView[];
}

/**
 * The profit of placed orders. The numbers come from the line snapshot, the courier booking and
 * the store's cost settings. Callers must already have ReadCost: this service does not check it.
 */
@Injectable()
export class CostService {
    constructor(
        private connection: TransactionalConnection,
        private settings: CostSettingsService,
        private translator: TranslatorService,
        private orders: OrderService,
    ) {}

    async profit(ctx: RequestContext, orderId: ID): Promise<OrderProfitView> {
        const order = await this.load(ctx, [orderId]);
        const found = order[0];
        if (!found?.orderPlacedAt) throw new UserInputError('error.entity-not-found', { entityName: 'Order' });
        return this.one(ctx, found);
    }

    async profits(ctx: RequestContext, orderIds: ID[]): Promise<OrderProfitView[]> {
        if (orderIds.length > PROFIT_BATCH) {
            throw new UserInputError('error.bd-cost.too-many', { max: String(PROFIT_BATCH) });
        }
        const orders = await this.load(ctx, orderIds);
        const views = await Promise.all(orders.filter(order => order.orderPlacedAt).map(order => this.one(ctx, order)));
        const byId = new Map(views.map(view => [String(view.orderId), view]));
        return orderIds.map(id => byId.get(String(id))).filter((view): view is OrderProfitView => !!view);
    }

    private load(ctx: RequestContext, ids: ID[]): Promise<Order[]> {
        if (!ids.length) return Promise.resolve([]);
        return this.connection.getRepository(ctx, Order).find({
            where: { id: In(ids) },
            relations: {
                lines: { productVariant: { translations: true } },
                payments: { refunds: true },
                surcharges: true,
            },
        });
    }

    private async one(ctx: RequestContext, order: Order): Promise<OrderProfitView> {
        const settings = await this.settings.get(ctx);
        const payments = order.payments ?? [];
        const paid = settledAmount({ payments });
        const pendingOnline = payments
            .filter(payment => payment.method === ONLINE_HANDLER_CODE && payment.state === 'Pending')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const codDue = Math.max(0, order.totalWithTax - paid - pendingOnline);
        const onlinePaid = payments
            .filter(payment => payment.method === ONLINE_HANDLER_CODE && payment.state === 'Settled')
            .reduce((sum, payment) => {
                const refunded = (payment.refunds ?? [])
                    .filter(refund => refund.state === 'Settled')
                    .reduce((total, refund) => total + refund.total, 0);
                return sum + Math.max(0, payment.amount - refunded);
            }, 0);
        const booking = await this.booking(ctx, order.id);
        const state = profitCountState(bdStatusOf(order.state));
        const delivered = state === 'partiallyDelivered' ? await this.deliveredByLine(ctx, order) : null;
        const paymentType =
            pendingOnline > 0 && codDue === 0 ? 'prepaid' : bdPaymentType(order.totalWithTax, paid);
        const calculated = orderProfit({
            state,
            lines: order.lines.map(line => ({
                quantity: line.quantity,
                returnedQuantity: this.keptBack(line, state, delivered),
                linePriceWithTax: line.linePriceWithTax,
                proratedLinePriceWithTax: line.proratedLinePriceWithTax,
                unitCost: line.customFields.unitCost ?? null,
            })),
            shippingWithTax: order.shippingWithTax,
            customerCodFee: (order.surcharges ?? [])
                .filter(surcharge => surcharge.sku === COD_FEE_SKU)
                .reduce((sum, surcharge) => sum + surcharge.priceWithTax, 0),
            courierDeliveryFee: booking?.deliveryFee ?? null,
            booked: !!booking && booking.status !== 'failed',
            courierName: booking ? courierLabel(booking) : null,
            paymentType,
            codDue,
            onlinePaid,
            settings,
        });
        return {
            ...calculated,
            orderId: order.id,
            lines: order.lines.map((line, index) => ({
                orderLineId: line.id,
                name: this.lineName(ctx, line),
                ...calculated.lines[index]!,
            })),
        };
    }

    /**
     * On a partial delivery, items Vendure marked delivered are what was kept. `returnedQuantity`
     * still counts when phase 37 recorded a return. Anything not delivered and not recorded is
     * left for the profit function to treat as unknown.
     */
    private keptBack(
        line: OrderLine,
        state: ReturnType<typeof profitCountState>,
        delivered: Map<string, number> | null,
    ): number {
        const recorded = line.customFields.returnedQuantity ?? 0;
        if (state !== 'partiallyDelivered' || !delivered) return recorded;
        const got = delivered.get(String(line.id));
        if (got == null) return recorded;
        return Math.max(recorded, line.quantity - got);
    }

    private async deliveredByLine(ctx: RequestContext, order: Order): Promise<Map<string, number>> {
        const fulfillments = await this.orders.getOrderFulfillments(ctx, order);
        const ids = fulfillments.filter(fulfillment => fulfillment.state === 'Delivered').map(fulfillment => fulfillment.id);
        const delivered = new Map<string, number>();
        if (!ids.length) return delivered;
        const rows = await this.connection.getRepository(ctx, Fulfillment).find({
            where: { id: In(ids) },
            relations: { lines: true },
        });
        for (const fulfillment of rows) {
            for (const line of fulfillment.lines ?? []) {
                const id = String(line.orderLineId);
                delivered.set(id, (delivered.get(id) ?? 0) + line.quantity);
            }
        }
        return delivered;
    }

    private lineName(ctx: RequestContext, line: OrderLine): string {
        const variant = line.productVariant;
        if (!variant) return '';
        return this.translator.translate(variant, ctx).name;
    }

    /** The live booking, or the latest one that named a charge. */
    private async booking(ctx: RequestContext, orderId: ID): Promise<BdCourierBooking | null> {
        const rows = await this.connection.getRepository(ctx, BdCourierBooking).find({
            where: { orderId },
            order: { createdAt: 'DESC' },
            take: 10,
        });
        return (
            rows.find(row => (LIVE_BOOKING_STATUSES as readonly string[]).includes(row.status)) ??
            rows.find(row => row.deliveryFee != null && row.status !== 'failed') ??
            null
        );
    }
}

function courierLabel(booking: BdCourierBooking): string | null {
    if (booking.courier === 'manual') return booking.courierName;
    return booking.courier || null;
}

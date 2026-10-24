import { findDistrict } from '@ecommbd/bd-geo';
import {
    bdStatusOf,
    type BdOrderStatus,
    newTrackingToken,
    normalizeOrderNumberSearch,
    parseBdMobile,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    HistoryService,
    type ID,
    Order,
    type OrderHistoryEntry,
    OrderService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { webcrypto } from 'node:crypto';
import { shipmentInfo } from '../bd-orders/shipment-info';

export interface TrackedOrder {
    /** Not in the API: for field resolvers of other plugins (online payments). */
    orderId: ID;
    orderNumber: string;
    placedAt: Date;
    status: BdOrderStatus;
    timeline: Array<{ status: BdOrderStatus; at: Date }>;
    firstName: string;
    district: string;
    lines: Array<{ name: string; quantity: number }>;
    total: number;
    codDue: number;
    courierTrackingUrl: string | null;
}

const COD_METHOD = 'bd-cod';
const STATE_TRANSITION = 'ORDER_STATE_TRANSITION' as OrderHistoryEntry['type'];

/**
 * Order tracking for shoppers (roadmap phase 14): finds a placed order by its number and the
 * phone it was ordered with, or by its tracking token, and returns only what the shopper may see.
 */
@Injectable()
export class TrackingService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private historyService: HistoryService,
    ) {}

    /** The order with this number whose customer has this phone, or null (any miss looks the same). */
    async byNumberAndPhone(
        ctx: RequestContext,
        orderNumber: string,
        phone: string,
    ): Promise<TrackedOrder | null> {
        const number = normalizeOrderNumberSearch(orderNumber.slice(0, 40));
        const mobile = parseBdMobile(phone.slice(0, 40));
        if (!number || !mobile.ok) return null;
        // "1001" also finds "MF-1001" when the store uses a prefix. Only digits reach the pattern.
        const digits = /^\d{1,12}$/.test(number) ? number : null;
        const rows: Array<{ id: ID }> = await this.connection.rawConnection.query(
            `SELECT o.id FROM "order" o JOIN customer c ON c.id = o."customerId"
             WHERE o."orderPlacedAt" IS NOT NULL AND c."customFieldsPhone" = $1
               AND (upper(o."customFieldsOrdernumber") = $2 OR ($3::text IS NOT NULL AND o."customFieldsOrdernumber" ~ ('-' || $3::text || '$')))
             ORDER BY o."orderPlacedAt" DESC LIMIT 1`,
            [mobile.phone.e164, number, digits],
        );
        return rows[0] ? this.view(ctx, rows[0].id) : null;
    }

    async byToken(ctx: RequestContext, token: string): Promise<TrackedOrder | null> {
        if (!/^[A-Za-z0-9_-]{20,32}$/.test(token)) return null;
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { customFields: { trackingToken: token } },
            select: { id: true, orderPlacedAt: true },
        });
        return order?.orderPlacedAt ? this.view(ctx, order.id) : null;
    }

    /** The order's token, created when missing (placed orders only). */
    async tokenFor(ctx: RequestContext, order: Order): Promise<string | null> {
        if (!order.orderPlacedAt) return null;
        const existing = (order.customFields as { trackingToken?: string | null }).trackingToken;
        if (existing) return existing;
        const token = newTrackingToken(bytes => webcrypto.getRandomValues(bytes));
        // Only if still empty: the SMS service may have just made one.
        await this.connection.rawConnection.query(
            `UPDATE "order" SET "customFieldsTrackingtoken" = $1 WHERE id = $2 AND "customFieldsTrackingtoken" IS NULL`,
            [token, order.id],
        );
        const stored: Array<{ token: string }> = await this.connection.rawConnection.query(
            `SELECT "customFieldsTrackingtoken" AS token FROM "order" WHERE id = $1`,
            [order.id],
        );
        return stored[0]?.token ?? null;
    }

    /** "Product · variation", in the request's language (Vendure doesn't load products with order lines). */
    private async lineNames(ctx: RequestContext, order: Order): Promise<TrackedOrder['lines']> {
        const ids = order.lines.map(line => line.productVariant.id);
        const rows: Array<{ variantId: string; languageCode: string; name: string }> = ids.length
            ? await this.connection.rawConnection.query(
                  `SELECT pv.id::text AS "variantId", pt."languageCode", pt.name
                   FROM product_variant pv JOIN product_translation pt ON pt."baseId" = pv."productId"
                   WHERE pv.id = ANY($1)`,
                  [ids],
              )
            : [];
        const productName = (variantId: string) => {
            const names = rows.filter(row => row.variantId === variantId);
            return (
                names.find(row => row.languageCode === ctx.languageCode) ??
                names.find(row => row.languageCode === ctx.channel.defaultLanguageCode) ??
                names[0]
            )?.name;
        };
        return order.lines.map(line => {
            const variant = line.productVariant.name;
            const product = productName(String(line.productVariant.id));
            const name = !product || variant.startsWith(product) ? variant : `${product} · ${variant}`;
            return { name, quantity: line.quantity };
        });
    }

    private async view(ctx: RequestContext, id: ID): Promise<TrackedOrder | null> {
        const order = await this.orderService.findOne(ctx, id);
        if (!order?.orderPlacedAt) return null;
        const history = await this.historyService.getHistoryForOrder(ctx, order.id, false, {
            filter: { type: { eq: STATE_TRANSITION } },
            take: 100,
        });
        const transitions = [...history.items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        // An online order is placed waiting for payment (phase 18); every other order is placed New.
        const placedAs = transitions.find(
            entry => (entry.data as { from?: string }).from === 'ArrangingPayment',
        );
        const firstStatus =
            bdStatusOf(String((placedAs?.data as { to?: string } | undefined)?.to ?? '')) ?? 'new';
        const timeline: TrackedOrder['timeline'] = [{ status: firstStatus, at: order.orderPlacedAt }];
        for (const entry of transitions) {
            const status = bdStatusOf(String((entry.data as { to?: string }).to ?? ''));
            if (!status || entry.createdAt < order.orderPlacedAt) continue;
            if (timeline[timeline.length - 1]!.status !== status)
                timeline.push({ status, at: entry.createdAt });
        }
        const address = order.shippingAddress ?? {};
        const districtId = (address.customFields as { districtId?: string } | undefined)?.districtId;
        const district = districtId ? findDistrict(districtId) : undefined;
        const language = ctx.languageCode === 'en' ? 'en' : 'bn';
        const codDue = (order.payments ?? [])
            .filter(payment => payment.method === COD_METHOD && payment.state === 'Authorized')
            .reduce((sum, payment) => sum + payment.amount, 0);
        return {
            orderId: order.id,
            orderNumber: (order.customFields as { orderNumber?: string | null }).orderNumber ?? order.code,
            placedAt: order.orderPlacedAt,
            status: bdStatusOf(order.state) ?? timeline[timeline.length - 1]!.status,
            timeline,
            // Only the first word of the name: nothing a stranger could use.
            firstName: (address.fullName ?? '').trim().split(/\s+/)[0] ?? '',
            district: district ? district[language] : '',
            lines: await this.lineNames(ctx, order),
            total: order.totalWithTax,
            codDue,
            courierTrackingUrl: (await shipmentInfo(ctx, order.id))?.trackingUrl ?? null,
        };
    }
}

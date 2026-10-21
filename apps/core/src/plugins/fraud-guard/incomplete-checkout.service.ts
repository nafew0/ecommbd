import { findDistrict, isThanaInDistrict } from '@ecommbd/bd-geo';
import {
    cleanText,
    type DismissReason,
    formatBdPhone,
    INCOMPLETE_RULES,
    INCOMPLETE_STATUSES,
    type IncompleteStatus,
    parseBdMobile,
} from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ActiveOrderService,
    type ID,
    Order,
    OrderService,
    type RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { StoreSettingsService } from '../bd-core';
import { CheckoutRateLimiter } from '../bd-checkout';
import { SmsService } from '../notifications';
import { PROGRESS_RATE_LIMITS } from './constants';
import { BdIncompleteCheckout, type CartSnapshotLine } from './entities';
import { staffName } from './staff';

export interface CheckoutProgressInput {
    phone: string;
    name?: string | null;
    districtId?: string | null;
    thanaId?: string | null;
    /** utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ref. */
    source?: Record<string, unknown> | null;
    /** The checkout form's hidden field: filled in only by bots. */
    website?: string | null;
}

const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ref'];
const DAY = 24 * 60 * 60_000;

/**
 * Incomplete checkouts (roadmap phase 11). The storefront saves the checkout as the shopper types
 * (from phase 14), once the phone is valid: one open record per phone, latest details win. An
 * order later from that phone (within 7 days) marks it recovered, or converted when staff entered
 * the order. After 30 days the personal data is deleted. The Shop API never returns any of it.
 */
@Injectable()
export class IncompleteCheckoutService {
    constructor(
        private connection: TransactionalConnection,
        private activeOrders: ActiveOrderService,
        private orders: OrderService,
        private moduleRef: ModuleRef,
    ) {}

    /** Always "true" to the shopper, whatever happened: nothing to learn from probing it. */
    async save(ctx: RequestContext, input: CheckoutProgressInput): Promise<boolean> {
        if (input.website?.trim()) return true;
        const parsed = parseBdMobile(input.phone ?? '');
        if (!parsed.ok) return true;
        const phone = parsed.phone.e164;
        const limiter = this.moduleRef.get(CheckoutRateLimiter, { strict: false });
        const session = String(ctx.session?.id ?? 'none');
        if (
            (await limiter.hit(`progress:session:${session}`, PROGRESS_RATE_LIMITS.perSession)) ||
            (await limiter.hit(`progress:phone:${phone}`, PROGRESS_RATE_LIMITS.perPhone))
        ) {
            return true;
        }
        const name = input.name ? cleanText(input.name).slice(0, 120) || null : null;
        const districtId = input.districtId && findDistrict(input.districtId) ? input.districtId : null;
        const thanaId =
            districtId && input.thanaId && isThanaInDistrict(districtId, input.thanaId) ? input.thanaId : null;
        const source = this.cleanSource(input.source);
        const active = ctx.authorizedAsOwnerOnly ? await this.activeOrders.getActiveOrder(ctx, undefined) : undefined;
        // The active order comes without its lines.
        const order = active ? await this.orders.findOne(ctx, active.id) : undefined;
        const lines = (order?.lines ?? []).filter(line => line.quantity > 0);
        const cart: CartSnapshotLine[] | null = lines.length
            ? lines.map(line => ({
                  variantId: line.productVariant.id,
                  name: line.productVariant.name,
                  quantity: line.quantity,
                  unitPrice: line.unitPriceWithTax,
              }))
            : null;
        const now = new Date();
        // One statement: bursts of debounced saves for one phone never make two open records.
        await this.connection.getRepository(ctx, BdIncompleteCheckout).query(
            `INSERT INTO "bd_incomplete_checkout"
                ("createdAt", "updatedAt", "status", "phone", "name", "districtId", "thanaId", "cart", "cartTotal", "source", "language")
             VALUES ($1, $1, 'open', $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT ("phone") WHERE "status" = 'open' DO UPDATE SET
                "updatedAt" = EXCLUDED."updatedAt",
                "name" = COALESCE(EXCLUDED."name", "bd_incomplete_checkout"."name"),
                "districtId" = COALESCE(EXCLUDED."districtId", "bd_incomplete_checkout"."districtId"),
                "thanaId" = COALESCE(EXCLUDED."thanaId", "bd_incomplete_checkout"."thanaId"),
                "cart" = COALESCE(EXCLUDED."cart", "bd_incomplete_checkout"."cart"),
                "cartTotal" = CASE WHEN EXCLUDED."cart" IS NULL THEN "bd_incomplete_checkout"."cartTotal" ELSE EXCLUDED."cartTotal" END,
                "source" = COALESCE(EXCLUDED."source", "bd_incomplete_checkout"."source"),
                "language" = EXCLUDED."language"`,
            [
                now,
                phone,
                name,
                districtId,
                thanaId,
                cart ? JSON.stringify(cart) : null,
                order && cart ? order.subTotalWithTax : 0,
                source ? JSON.stringify(source) : null,
                ctx.languageCode === 'en' ? 'en' : 'bn',
            ],
        );
        return true;
    }

    /** An order from the same phone: recovered (the shopper came back) or converted (staff entered it). */
    async onOrderPlaced(ctx: RequestContext, order: Order): Promise<void> {
        const phone = order.customer?.customFields?.phone;
        if (!phone) return;
        const manual = Boolean(order.customFields.source && order.customFields.source !== 'web');
        const now = new Date();
        await this.connection
            .getRepository(ctx, BdIncompleteCheckout)
            .createQueryBuilder()
            .update()
            .set({ status: manual ? 'converted' : 'recovered', orderId: order.id, closedAt: now })
            .where('"phone" = :phone AND "status" = \'open\' AND "updatedAt" >= :since', {
                phone,
                since: new Date(now.getTime() - INCOMPLETE_RULES.recoverWithinDays * DAY),
            })
            .execute();
    }

    async list(
        ctx: RequestContext,
        options: { status?: IncompleteStatus | null; search?: string | null; skip?: number; take?: number },
    ) {
        const query = this.connection
            .getRepository(ctx, BdIncompleteCheckout)
            .createQueryBuilder('c')
            .orderBy('c.updatedAt', 'DESC')
            .skip(options.skip ?? 0)
            .take(Math.min(options.take ?? 50, 100));
        if (options.status) query.where('c.status = :status', { status: options.status });
        const digits = options.search?.replace(/\D/g, '');
        if (digits) query.andWhere('c.phone LIKE :phone', { phone: `%${digits}%` });
        const [items, totalItems] = await query.getManyAndCount();
        return { items, totalItems };
    }

    async counts(ctx: RequestContext): Promise<Record<IncompleteStatus, number>> {
        const rows: Array<{ status: IncompleteStatus; count: number }> = await this.connection
            .getRepository(ctx, BdIncompleteCheckout)
            .query(`SELECT "status", COUNT(*)::int AS count FROM "bd_incomplete_checkout" GROUP BY "status"`);
        const counts = Object.fromEntries(INCOMPLETE_STATUSES.map(status => [status, 0])) as Record<IncompleteStatus, number>;
        for (const row of rows) counts[row.status] = row.count;
        return counts;
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, BdIncompleteCheckout).findOne({ where: { id } });
    }

    async dismiss(ctx: RequestContext, id: ID, reason: DismissReason): Promise<BdIncompleteCheckout | null> {
        const repository = this.connection.getRepository(ctx, BdIncompleteCheckout);
        const record = await repository.findOne({ where: { id, status: 'open' } });
        if (!record) return null;
        record.status = 'dismissed';
        record.dismissReason = reason;
        record.closedBy = await staffName(this.connection, ctx);
        record.closedAt = new Date();
        return repository.save(record);
    }

    /** Staff send the "your order is waiting" SMS: once per record. */
    async sendSms(ctx: RequestContext, id: ID): Promise<BdIncompleteCheckout | null> {
        const repository = this.connection.getRepository(ctx, BdIncompleteCheckout);
        const record = await repository.findOne({ where: { id, status: 'open' } });
        if (!record?.phone) return null;
        const language = record.language === 'en' ? 'en' : 'bn';
        const { profile } = await this.moduleRef.get(StoreSettingsService, { strict: false }).get(ctx);
        await this.moduleRef.get(SmsService, { strict: false }).queueSms(ctx, {
            event: 'incomplete',
            to: record.phone,
            language,
            key: `incomplete:${record.id}`,
            values: {
                name: record.name,
                storeName: profile.storeName[language] || profile.storeName.bn || profile.storeName.en,
                storePhone: profile.phones[0] ? formatBdPhone(profile.phones[0]) : null,
            },
        });
        record.smsSentAt = record.smsSentAt ?? new Date();
        return repository.save(record);
    }

    /** Daily: personal data of records older than 30 days is deleted; open ones become expired. */
    async expire(ctx: RequestContext): Promise<number> {
        const before = new Date(Date.now() - INCOMPLETE_RULES.expiryDays * DAY);
        const result = await this.connection
            .getRepository(ctx, BdIncompleteCheckout)
            .createQueryBuilder()
            .update()
            .set({
                status: () => `CASE WHEN "status" = 'open' THEN 'expired' ELSE "status" END`,
                phone: null,
                name: null,
                cart: null,
                source: null,
            })
            .where('"createdAt" < :before AND "phone" IS NOT NULL', { before })
            .execute();
        return result.affected ?? 0;
    }

    private cleanSource(source: Record<string, unknown> | null | undefined): Record<string, string> | null {
        if (!source || typeof source !== 'object') return null;
        const kept = Object.fromEntries(
            SOURCE_KEYS.flatMap(key =>
                typeof source[key] === 'string' && source[key] ? [[key, cleanText(source[key]).slice(0, 200)]] : [],
            ),
        );
        return Object.keys(kept).length ? kept : null;
    }
}

/** The order number a recovered or converted record became, for the list. */
export async function orderNumberOf(connection: TransactionalConnection, ctx: RequestContext, orderId: ID | null) {
    if (!orderId) return null;
    const order = await connection.getRepository(ctx, Order).findOne({ where: { id: orderId } });
    return order ? (order.customFields.orderNumber ?? order.code) : null;
}

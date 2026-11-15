import { Injectable } from '@nestjs/common';
import { Order, OrderLine, ProductVariant, RequestContext, TransactionalConnection } from '@vendure/core';
import { ORDER_LINE_COST_COLUMN } from './constants';

/**
 * Copies the variation's cost onto an order line once, and never again.
 *
 * Placement copies every line. A line added while editing a placed order is copied when it is
 * created. Vendure's order edit tries the change and rolls it back first, so the create event's
 * write can be undone: the following quantity update copies the cost if the line is newer than
 * the order and still has none. A line that was already on the order keeps a missing cost as
 * missing. Changing the product later does not touch the line.
 */
@Injectable()
export class CostSnapshotService {
    constructor(private connection: TransactionalConnection) {}

    async onPlaced(ctx: RequestContext, order: Order): Promise<void> {
        const full = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: order.id },
            relations: { lines: { productVariant: true } },
        });
        if (!full) return;
        for (const line of full.lines) {
            if (line.quantity <= 0 || line.customFields.unitCost != null) continue;
            await this.write(ctx, line.id, line.productVariant?.customFields.unitCost ?? null);
        }
    }

    async onLine(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        type: 'created' | 'updated' | 'deleted' | 'cancelled',
    ): Promise<void> {
        if (type !== 'created' && type !== 'updated') return;
        const placedAt = await this.placedAt(ctx, order);
        if (!placedAt) return;
        const [row] = (await this.connection.getRepository(ctx, OrderLine).query(
            `SELECT "createdAt" AS created, "${ORDER_LINE_COST_COLUMN}" AS cost FROM "order_line" WHERE id = $1`,
            [line.id],
        )) as Array<{ created: Date | string; cost: number | null }>;
        if (!row || row.cost != null) return;
        // An update of a line that was on the order when it was placed must not fill a missing cost.
        if (type === 'updated' && new Date(row.created).getTime() <= placedAt.getTime()) return;
        const variantId = line.productVariantId ?? line.productVariant?.id;
        const variant = variantId
            ? await this.connection.getRepository(ctx, ProductVariant).findOne({ where: { id: variantId } })
            : null;
        await this.write(ctx, line.id, variant?.customFields.unitCost ?? null);
    }

    /** Lines added after the order was placed that still have no cost. Called after an edit commits its lines. */
    async snapshotAdded(ctx: RequestContext, orderId: Order['id']): Promise<void> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId },
            relations: { lines: { productVariant: true } },
        });
        if (!order?.orderPlacedAt) return;
        const placed = new Date(order.orderPlacedAt).getTime();
        for (const line of order.lines) {
            if (line.customFields.unitCost != null) continue;
            if (new Date(line.createdAt).getTime() <= placed) continue;
            await this.write(ctx, line.id, line.productVariant?.customFields.unitCost ?? null);
        }
    }

    private async placedAt(ctx: RequestContext, order: Order): Promise<Date | null> {
        if (order.orderPlacedAt) return new Date(order.orderPlacedAt);
        const loaded = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: order.id },
            select: { id: true, orderPlacedAt: true },
        });
        return loaded?.orderPlacedAt ? new Date(loaded.orderPlacedAt) : null;
    }

    private async write(ctx: RequestContext, lineId: OrderLine['id'], cost: number | null): Promise<void> {
        await this.connection
            .getRepository(ctx, OrderLine)
            .query(`UPDATE "order_line" SET "${ORDER_LINE_COST_COLUMN}" = $1 WHERE id = $2`, [cost, lineId]);
    }
}

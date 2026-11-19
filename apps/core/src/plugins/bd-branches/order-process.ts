import { Order, type OrderProcess, type RequestContext, TransactionalConnection } from '@vendure/core';
import { StockService } from '../bd-catalog';
import { BranchService } from './branch.service';

const PLACING = new Set(['PaymentAuthorized', 'PaymentSettled', 'AwaitingPayment']);

/**
 * When an order is placed, remember which branch should ship it and whether the goods are
 * somewhere else. When a shipped order is marked returned, put the sold units back at the
 * branch the sale came out of, less anything the customer kept on a partial delivery.
 * Cancel-before-ship is Vendure's own release.
 */
export function branchOrderProcess(): OrderProcess<never> {
    let branches: BranchService;
    let stock: StockService;
    let connection: TransactionalConnection;

    return {
        init(injector) {
            branches = injector.get(BranchService);
            stock = injector.get(StockService);
            connection = injector.get(TransactionalConnection);
        },

        async onTransitionEnd(fromState, toState, { ctx, order }) {
            if (PLACING.has(toState) && !PLACING.has(fromState)) {
                const branchId = await branches.shippingBranchId(ctx, order);
                order.customFields.shippingBranchId = Number(branchId);
                order.customFields.transferNeeded = await branches.transferNeeded(ctx, order.id, branchId);
            }
            if (toState === 'Returned' && !order.customFields.returnStockRestored) {
                await restoreSales(ctx, connection, stock, order.id, order.customFields.orderNumber ?? order.code);
                order.customFields.returnStockRestored = true;
            }
        },
    };
}

async function restoreSales(
    ctx: RequestContext,
    connection: TransactionalConnection,
    stock: StockService,
    orderId: string | number,
    note: string,
): Promise<void> {
    const repo = connection.getRepository(ctx, Order);
    const sold = (await repo.query(
        `SELECT sm."orderLineId" AS "lineId", sm."productVariantId" AS "variantId",
                sm."stockLocationId" AS "locationId", SUM(sm.quantity)::int AS quantity
         FROM stock_movement sm
         INNER JOIN order_line ol ON ol.id = sm."orderLineId"
         WHERE ol."orderId" = $1 AND sm.type = 'SALE'
         GROUP BY sm."orderLineId", sm."productVariantId", sm."stockLocationId"
         ORDER BY sm."orderLineId", sm."stockLocationId"`,
        [orderId],
    )) as Array<{ lineId: string | number; variantId: string | number; locationId: string | number; quantity: number }>;
    // A partly delivered order that comes back: the customer kept what was delivered.
    const deliveredRows = (await repo.query(
        `SELECT olr."orderLineId" AS "lineId", SUM(olr.quantity)::int AS quantity
         FROM order_line_reference olr
         INNER JOIN fulfillment f ON f.id = olr."fulfillmentId"
         INNER JOIN order_line ol ON ol.id = olr."orderLineId"
         WHERE ol."orderId" = $1 AND olr.discriminator = 'FulfillmentLine' AND f.state = 'Delivered'
         GROUP BY olr."orderLineId"`,
        [orderId],
    )) as Array<{ lineId: string | number; quantity: number }>;
    const kept = new Map(deliveredRows.map(row => [String(row.lineId), Number(row.quantity)]));
    for (const row of sold) {
        // A sale is stored as a negative movement. Putting the units back adds that many.
        const out = -Number(row.quantity);
        const keptHere = Math.min(out, kept.get(String(row.lineId)) ?? 0);
        kept.set(String(row.lineId), (kept.get(String(row.lineId)) ?? 0) - keptHere);
        const quantity = out - keptHere;
        if (quantity <= 0) continue;
        await stock.adjust(ctx, {
            variantId: row.variantId,
            change: quantity,
            reason: 'returned',
            note,
            stockLocationId: row.locationId,
        });
    }
}

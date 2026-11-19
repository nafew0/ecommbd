import { Order, type OrderProcess, type RequestContext, TransactionalConnection } from '@vendure/core';
import { StockService } from '../bd-catalog';
import { BranchService } from './branch.service';

const PLACING = new Set(['PaymentAuthorized', 'PaymentSettled', 'AwaitingPayment']);

/**
 * When an order is placed, remember which branch should ship it and whether the goods are
 * somewhere else. When a shipped order is marked returned, put the sold units back at the
 * branch the sale came out of. Cancel-before-ship is Vendure's own release.
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
    const rows = (await connection.getRepository(ctx, Order).query(
        `SELECT sm."productVariantId" AS "variantId", sm."stockLocationId" AS "locationId",
                SUM(sm.quantity)::int AS quantity
         FROM stock_movement sm
         INNER JOIN order_line ol ON ol.id = sm."orderLineId"
         WHERE ol."orderId" = $1 AND sm.type = 'SALE'
         GROUP BY sm."productVariantId", sm."stockLocationId"`,
        [orderId],
    )) as Array<{ variantId: string | number; locationId: string | number; quantity: number }>;
    for (const row of rows) {
        // A sale is stored as a negative movement. Putting the units back adds that many.
        const quantity = -Number(row.quantity);
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

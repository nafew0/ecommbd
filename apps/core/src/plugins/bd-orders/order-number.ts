import { formatOrderNumber } from '@ecommbd/shared';
import { Order, type RequestContext, TransactionalConnection } from '@vendure/core';

/**
 * The PostgreSQL sequence behind order numbers. Created by the migration `bd-order-numbers`; the
 * same statement runs for test databases, which Vendure builds without migrations.
 */
export const ORDER_NUMBER_SEQUENCE = 'bd_order_number_seq';
export const CREATE_ORDER_NUMBER_SEQUENCE_SQL = `CREATE SEQUENCE IF NOT EXISTS "${ORDER_NUMBER_SEQUENCE}" START WITH 1001`;

/**
 * The next order number, drawn inside the placing transaction. Sequences are safe under
 * concurrency (no two orders share a number) and never draw for carts, so numbers have no gaps
 * from abandoned carts; one is lost only if a placement fails after drawing it.
 */
export async function nextOrderNumber(
    connection: TransactionalConnection,
    ctx: RequestContext,
    prefix: string,
): Promise<string> {
    const [row] = (await connection
        .getRepository(ctx, Order)
        .query(`SELECT nextval('"${ORDER_NUMBER_SEQUENCE}"') AS value`)) as Array<{ value: string }>;
    return formatOrderNumber(prefix, Number(row!.value));
}

import type { TxSource } from '@ecommbd/shared';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { BdAccount, BdTransaction } from './entities';

export interface LedgerRow {
    accountId: number;
    direction: 'in' | 'out';
    amount: number;
    /** Dhaka day, YYYY-MM-DD. */
    day: string;
    source: TxSource;
    sourceId?: string | null;
    note?: string;
    transferId?: string | null;
    idempotencyKey: string;
    /** An edited expense updates the row that already has this key. */
    upsert?: boolean;
}

/**
 * The one place a movement is written. A key that already exists is left as it is,
 * unless `upsert` replaces the amount, account and day (an expense that was edited).
 */
export async function insertTransaction(
    ctx: RequestContext,
    connection: TransactionalConnection,
    row: LedgerRow,
): Promise<void> {
    const accounts = connection.getRepository(ctx, BdAccount);
    const account = await accounts.findOne({ where: { id: row.accountId } });
    if (!account) throw new UserInputError('message.bd-accounts.not-found');
    const repo = connection.getRepository(ctx, BdTransaction);
    const existing = await repo.findOne({ where: { idempotencyKey: row.idempotencyKey } });
    if (existing) {
        if (!row.upsert) return;
        existing.accountId = row.accountId;
        existing.direction = row.direction;
        existing.amount = row.amount;
        existing.day = row.day;
        existing.source = row.source;
        existing.sourceId = row.sourceId ?? null;
        existing.note = row.note ?? '';
        await repo.save(existing);
        return;
    }
    try {
        await repo.save(
            new BdTransaction({
                accountId: row.accountId,
                direction: row.direction,
                amount: row.amount,
                day: row.day,
                source: row.source,
                sourceId: row.sourceId ?? null,
                note: (row.note ?? '').slice(0, 500),
                transferId: row.transferId ?? null,
                idempotencyKey: row.idempotencyKey,
            }),
        );
    } catch (error) {
        if (uniqueViolation(error)) return;
        throw error;
    }
}

function uniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error == null) return false;
    const row = error as { code?: string; driverError?: { code?: string } };
    return row.code === '23505' || row.driverError?.code === '23505';
}

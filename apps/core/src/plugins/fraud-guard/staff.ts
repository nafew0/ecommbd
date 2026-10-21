import type { RequestContext, TransactionalConnection } from '@vendure/core';

/** The signed-in staff member's name, for "added by" and "closed by". */
export async function staffName(connection: TransactionalConnection, ctx: RequestContext): Promise<string> {
    const user = ctx.activeUserId;
    if (!user) return '';
    const [row] = await connection.rawConnection.query(
        'SELECT "firstName", "lastName" FROM "administrator" WHERE "userId" = $1',
        [user],
    );
    return row ? `${row.firstName} ${row.lastName}`.trim() : '';
}

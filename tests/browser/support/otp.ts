import { createHash } from 'node:crypto';
// pg comes with TypeORM (the core's database driver); only tests read the database directly.
import pg from 'pg';

/**
 * The COD verification code last sent to a phone (phase 11), as only a test can know it: the store
 * keeps just SHA-256("<orderId>:<code>"), so the test reads the hash from the database (the
 * docker-compose PostgreSQL, or the DB_* settings CI uses) and tries all 10⁶ codes.
 */
export async function latestOtpCode(phoneE164: string, timeoutMs = 10_000): Promise<string> {
    const client = new pg.Client({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 54320),
        database: process.env.DB_NAME ?? 'ecommbd',
        user: process.env.DB_USERNAME ?? 'ecommbd',
        password: process.env.DB_PASSWORD ?? 'ecommbd',
    });
    await client.connect();
    try {
        const started = Date.now();
        for (;;) {
            const { rows } = await client.query<{ orderId: number; codeHash: string }>(
                'SELECT "orderId", "codeHash" FROM bd_otp_code WHERE phone = $1 ORDER BY id DESC LIMIT 1',
                [phoneE164],
            );
            const row = rows[0];
            if (row) {
                for (let n = 0; n < 1_000_000; n++) {
                    const code = String(n).padStart(6, '0');
                    if (createHash('sha256').update(`${row.orderId}:${code}`).digest('hex') === row.codeHash)
                        return code;
                }
                throw new Error('No 6-digit code matches the stored hash');
            }
            if (Date.now() - started > timeoutMs)
                throw new Error(`No code was sent to ${phoneE164.slice(-3)}`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    } finally {
        await client.end();
    }
}

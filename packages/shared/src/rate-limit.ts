/**
 * Fixed-window rate limits ("at most 10 tries per 10 minutes per phone").
 *
 * The count and its expiry are set in one atomic step, so concurrent requests can't slip past the
 * limit. Keys should name what is limited and by what: `checkout:phone:+8801712345678`.
 */

export interface RateLimitRule {
    /** Requests allowed in each window. */
    limit: number;
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    /** Requests counted in this window, including this one. */
    count: number;
    /** When refused: milliseconds until the window resets. 0 when allowed. */
    retryAfterMs: number;
}

/** Storage for the counters. Implementations: in-memory (tests) and Redis. */
export interface RateLimitStore {
    /** Adds one to the key's counter, starting a new window if none is open. */
    increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
    private readonly windows = new Map<string, { count: number; expiresAt: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    async increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
        // No await between the read and the write: concurrent callers can't share one count.
        const now = this.now();
        const current = this.windows.get(key);
        if (!current || current.expiresAt <= now) {
            this.windows.set(key, { count: 1, expiresAt: now + windowMs });
            return { count: 1, ttlMs: windowMs };
        }
        current.count += 1;
        return { count: current.count, ttlMs: current.expiresAt - now };
    }
}

/** The part of a Redis client this needs (ioredis' `eval`), so this package has no Redis dependency. */
export interface RedisScriptClient {
    eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/** INCR and the expiry in one script: atomic, and a key can never be left without an expiry. */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore {
    /** `prefix` keeps each store's keys apart, e.g. `s42:rl:`. */
    constructor(
        private readonly redis: RedisScriptClient,
        private readonly prefix: string,
    ) {}

    async increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
        const [count, ttlMs] = (await this.redis.eval(
            INCREMENT_SCRIPT,
            1,
            `${this.prefix}${key}`,
            windowMs,
        )) as [number, number];
        return { count, ttlMs };
    }
}

/** Counts one request against `rule` and says whether it's allowed. */
export async function hitRateLimit(
    store: RateLimitStore,
    key: string,
    rule: RateLimitRule,
): Promise<RateLimitResult> {
    const { count, ttlMs } = await store.increment(key, rule.windowMs);
    const allowed = count <= rule.limit;
    return { allowed, count, retryAfterMs: allowed ? 0 : ttlMs };
}

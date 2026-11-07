import { BKASH_LIMITS, decryptSecret, encryptSecret, type Keyring, parseKeyring } from '@ecommbd/shared';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@vendure/core';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { loggerCtx, PAYMENTS_ONLINE_OPTIONS } from './constants';
import { type BkashToken, requestBkashToken } from './drivers/bkash';
import { type GatewayCall, GatewayError } from './drivers/types';
import type { PaymentsOnlinePluginOptions } from './types';

/** The store's bKash token, as kept (encrypted) in Redis. Times are epoch milliseconds. */
interface StoredToken {
    idToken: string;
    refreshToken: string | null;
    issuedAt: number;
    /** Refreshed from here: between minutes 50 and 55 of the hour it lives. */
    refreshAt: number;
    expiresAt: number;
    refreshExpiresAt: number;
}

/** Where tokens, the lock and the count of token calls live: Redis, or this process's memory. */
interface TokenStore {
    read(key: string): Promise<string | null>;
    write(key: string, value: string, ttlMs: number): Promise<void>;
    /** Takes the lock; returns its owner value, or null when another process holds it. */
    lock(key: string, ttlMs: number): Promise<string | null>;
    unlock(key: string, owner: string): Promise<void>;
    /** Token calls in the last hour. */
    recentCalls(key: string, now: number): Promise<number>;
    addCall(key: string, now: number): Promise<void>;
    clear(prefix: string): Promise<void>;
}

const HOUR = 60 * 60_000;
const LOCK_MS = 2 * BKASH_LIMITS.timeoutMs;
const WAIT_MS = 10_000;

/** A Redis failure, as opposed to bKash's answer: the token then comes from memory. */
class StoreError extends Error {}

class RedisTokenStore implements TokenStore {
    constructor(private redis: Redis) {}

    private async run<T>(command: () => Promise<T>): Promise<T> {
        try {
            return await command();
        } catch (error) {
            throw new StoreError(String(error));
        }
    }

    read(key: string) {
        return this.run(() => this.redis.get(key));
    }

    async write(key: string, value: string, ttlMs: number) {
        await this.run(() => this.redis.set(key, value, 'PX', Math.max(1, Math.round(ttlMs))));
    }

    async lock(key: string, ttlMs: number) {
        const owner = randomBytes(8).toString('hex');
        const taken = await this.run(() => this.redis.set(key, owner, 'PX', ttlMs, 'NX'));
        return taken === 'OK' ? owner : null;
    }

    async unlock(key: string, owner: string) {
        // Only our own lock: it may have expired and been taken by another process meanwhile.
        await this.run(() =>
            this.redis.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                key,
                owner,
            ),
        );
    }

    async recentCalls(key: string, now: number) {
        return this.run(async () => {
            await this.redis.zremrangebyscore(key, 0, now - HOUR);
            return this.redis.zcard(key);
        });
    }

    async addCall(key: string, now: number) {
        await this.run(async () => {
            await this.redis.zadd(key, now, `${now}:${randomBytes(4).toString('hex')}`);
            await this.redis.pexpire(key, HOUR);
        });
    }

    async clear(prefix: string) {
        await this.run(async () => {
            let cursor = '0';
            do {
                const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
                cursor = next;
                if (keys.length) await this.redis.del(...keys);
            } while (cursor !== '0');
        });
    }
}

class MemoryTokenStore implements TokenStore {
    private values = new Map<string, { value: string; until: number }>();
    private calls = new Map<string, number[]>();

    async read(key: string) {
        const entry = this.values.get(key);
        return entry && entry.until > Date.now() ? entry.value : null;
    }

    async write(key: string, value: string, ttlMs: number) {
        this.values.set(key, { value, until: Date.now() + ttlMs });
    }

    async lock(key: string, ttlMs: number) {
        if (await this.read(key)) return null;
        const owner = randomBytes(8).toString('hex');
        await this.write(key, owner, ttlMs);
        return owner;
    }

    async unlock(key: string, owner: string) {
        if ((await this.read(key)) === owner) this.values.delete(key);
    }

    async recentCalls(key: string, now: number) {
        const recent = (this.calls.get(key) ?? []).filter(at => at > now - HOUR);
        this.calls.set(key, recent);
        return recent.length;
    }

    async addCall(key: string, now: number) {
        this.calls.set(key, [...(this.calls.get(key) ?? []), now]);
    }

    async clear() {
        this.values.clear();
        this.calls.clear();
    }
}

/**
 * The store's bKash token, shared by the server and the worker (roadmap phase 18, bKash v2). bKash
 * blocks an app for an hour after a third grant or refresh in an hour, so:
 * - one token per set of credentials, kept in the cache Redis encrypted with SECRETS_KEYRING;
 * - refreshed between minutes 50 and 55 of its hour, by one process at a time (a lock);
 * - a third token call in an hour is refused here, with an alert, instead of being sent;
 * - without Redis it falls back to this process's memory (and its own count).
 */
@Injectable()
export class BkashTokenService implements OnModuleDestroy {
    private readonly redis: Redis | null;
    private readonly redisStore: RedisTokenStore | null;
    private readonly memory = new MemoryTokenStore();
    private readonly prefix: string;
    private readonly keyring: Keyring | null;

    constructor(@Inject(PAYMENTS_ONLINE_OPTIONS) options: PaymentsOnlinePluginOptions) {
        this.prefix = `${options.redisKeyPrefix ?? 'ecommbd'}:bkash:`;
        this.keyring = options.keyring ? parseKeyring(options.keyring) : null;
        if (options.redis) {
            // Connects on first use; a slow Redis never holds up a payment.
            this.redis = new Redis({
                ...options.redis,
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                commandTimeout: 1000,
            });
            this.redis.on('error', () => undefined);
            this.redisStore = new RedisTokenStore(this.redis);
        } else {
            this.redis = null;
            this.redisStore = null;
        }
    }

    async onModuleDestroy() {
        if (!this.redis) return;
        if (this.redis.status === 'ready') await this.redis.quit();
        else this.redis.disconnect();
    }

    /** The id_token for these credentials. `renew` after bKash answered 401: a new one, if the limit allows. */
    async token(call: GatewayCall, renew: boolean): Promise<string> {
        if (this.redisStore) {
            try {
                return await this.tokenFrom(this.redisStore, call, renew);
            } catch (error) {
                if (!(error instanceof StoreError)) throw error;
                Logger.warn(`bKash token kept in memory (Redis unavailable): ${error.message}`, loggerCtx);
            }
        }
        return this.tokenFrom(this.memory, call, renew);
    }

    /** For tests: forgets every token and count. */
    async clear() {
        await this.memory.clear();
        await this.redisStore?.clear(this.prefix).catch(() => undefined);
    }

    /** One key per set of credentials and address: new credentials get a token of their own. */
    private keyOf(call: GatewayCall): string {
        const { username = '', password = '', appKey = '', appSecret = '' } = call.credentials;
        const hash = createHash('sha256')
            .update([call.baseUrl, username, password, appKey, appSecret].join('\n'))
            .digest('hex')
            .slice(0, 24);
        return `${this.prefix}${hash}`;
    }

    private async read(store: TokenStore, key: string): Promise<StoredToken | null> {
        const value = await store.read(key);
        if (!value) return null;
        try {
            const text = this.keyring ? decryptSecret(value, this.keyring, 'bkash-token') : value;
            return JSON.parse(text) as StoredToken;
        } catch {
            // A rotated-away key: a new token is fetched.
            return null;
        }
    }

    private async write(store: TokenStore, key: string, token: StoredToken) {
        const text = JSON.stringify(token);
        const value = this.keyring ? encryptSecret(text, this.keyring, 'bkash-token') : text;
        await store.write(key, value, Math.max(token.refreshExpiresAt, token.expiresAt) - Date.now());
    }

    private async tokenFrom(store: TokenStore, call: GatewayCall, renew: boolean): Promise<string> {
        const key = this.keyOf(call);
        const now = Date.now();
        const cached = await this.read(store, key);
        if (!renew && cached && now < cached.refreshAt) return cached.idToken;
        const owner = await store.lock(`${key}:lock`, LOCK_MS);
        if (!owner) {
            // Another process is fetching one: the current token is still good until it expires.
            if (!renew && cached && now < cached.expiresAt - 60_000) return cached.idToken;
            return this.waitForToken(store, key, cached?.idToken ?? null);
        }
        try {
            const fresh = await this.read(store, key);
            // Someone fetched one while we waited for the lock.
            if (fresh && (!cached || fresh.issuedAt > cached.issuedAt) && now < fresh.refreshAt) {
                return fresh.idToken;
            }
            if (!renew && fresh && now < fresh.refreshAt) return fresh.idToken;
            const next = await this.fetch(store, key, call, fresh, renew);
            return next.idToken;
        } finally {
            await store.unlock(`${key}:lock`, owner).catch(() => undefined);
        }
    }

    /** A refresh (or a grant without a refresh token), within bKash's two calls an hour. */
    private async fetch(
        store: TokenStore,
        key: string,
        call: GatewayCall,
        current: StoredToken | null,
        renew: boolean,
    ): Promise<StoredToken> {
        const now = Date.now();
        const callsKey = `${key}:calls`;
        const spend = async () => {
            if ((await store.recentCalls(callsKey, now)) >= BKASH_LIMITS.tokenCallsPerHour) {
                Logger.error(
                    'bKash token limit reached (2 grant or refresh calls an hour); not asking bKash again yet',
                    loggerCtx,
                );
                throw new GatewayError('bKash allows 2 token requests an hour: try again later');
            }
            await store.addCall(callsKey, now);
        };
        let issued: BkashToken;
        const canRefresh = !!current?.refreshToken && now < current.refreshExpiresAt;
        try {
            await spend();
        } catch (error) {
            // Over the limit but the current token hasn't expired: keep using it.
            if (!renew && current && now < current.expiresAt - 60_000) return current;
            throw error;
        }
        try {
            issued = await requestBkashToken(call, canRefresh ? current!.refreshToken! : undefined);
        } catch (error) {
            if (!canRefresh || !(error instanceof GatewayError)) throw error;
            // The refresh token was refused: a grant, if the limit allows a second call.
            await spend();
            issued = await requestBkashToken(call);
        }
        // Refreshed between minutes 50 and 55 of an hour (in proportion for a shorter life).
        const share =
            (BKASH_LIMITS.refreshFromMs +
                Math.random() * (BKASH_LIMITS.refreshUntilMs - BKASH_LIMITS.refreshFromMs)) /
            BKASH_LIMITS.tokenLifetimeMs;
        const token: StoredToken = {
            idToken: issued.idToken,
            refreshToken: issued.refreshToken ?? current?.refreshToken ?? null,
            issuedAt: now,
            refreshAt: now + Math.floor(issued.expiresInMs * share),
            expiresAt: now + issued.expiresInMs,
            refreshExpiresAt: issued.refreshToken
                ? now + BKASH_LIMITS.refreshTokenLifetimeMs
                : (current?.refreshExpiresAt ?? now + issued.expiresInMs),
        };
        await this.write(store, key, token);
        return token;
    }

    private async waitForToken(store: TokenStore, key: string, previous: string | null): Promise<string> {
        const until = Date.now() + WAIT_MS;
        while (Date.now() < until) {
            await new Promise(resolve => setTimeout(resolve, 200));
            const token = await this.read(store, key);
            if (token && token.idToken !== previous && Date.now() < token.expiresAt) return token.idToken;
        }
        throw new GatewayError('bKash token is being renewed: try again in a moment');
    }
}

import {
    dhakaDateKey,
    hitRateLimit,
    MemoryRateLimitStore,
    type RateLimitRule,
    type RateLimitStore,
    RedisRateLimitStore,
} from '@ecommbd/shared';
import { Body, Controller, Inject, Injectable, type OnModuleDestroy, Post, Req, Res } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Logger, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { CacheVitalSample } from './entities';
import { CACHE_OPTIONS, type CachePurgeOptions } from './options';

/**
 * Real-user speed measurement (roadmap phase 17): the storefront's sampled web-vitals beacon posts
 * LCP, INP and CLS to `/cache-metrics`; staff read the daily p75 per kind of page
 * (`cacheDailyVitals`, phase 41's reports). Anonymous: no address, query, referrer, cookie, IP or
 * device is stored, only the metric, its value, the kind of page and the Dhaka day.
 *
 * Anyone can post to a public endpoint, so it is kept cheap and hard to skew: a strict payload,
 * limits per visitor address and per store, and one statement per sample (no lock, no count).
 */

/** The kinds of page the storefront reports (`routeKind` in the storefront's cache-policy.ts). */
const ROUTES = ['home', 'product', 'category', 'sales', 'page', 'search', 'checkout', 'cart', 'other'];
const METRICS = ['LCP', 'INP', 'CLS'];
/** web-vitals' per-page-view ID: `v6-<page load time in ms>-<13 random digits>`. */
const METRIC_ID = /^v\d{1,2}-\d{13}-\d{13}$/;
/** Above these a value is a broken measurement (a minute for LCP and INP; CLS rarely passes 1). */
const MAX_MS = 60_000;
const MAX_CLS = 10;

/** Samples older than this many days are deleted (daily, 03:37). */
const KEEP_DAYS = 31;
/** `cacheDailyVitals` covers the last 30 Dhaka days, today included. */
const REPORT_DAYS = 30;

/**
 * Beacon limits. A sampled page view sends at most three measurements, so 60 a minute from one
 * address is 20 sampled views, enough for many shoppers behind one mobile operator's shared
 * address (CGNAT is common in Bangladesh). The daily limit per address caps how far one abuser
 * can move a store's p75; the per-store limits cap the table's growth. Per minute and per day
 * windows start with the first request (fixed windows).
 */
export const VITALS_LIMITS = {
    perAddress: { limit: 60, windowMs: 60_000 },
    perAddressDaily: { limit: 1000, windowMs: 86_400_000 },
    perStore: { limit: 1200, windowMs: 60_000 },
    perStoreDaily: { limit: 50_000, windowMs: 86_400_000 },
} satisfies Record<string, RateLimitRule>;

export interface VitalSample {
    metricId: string;
    name: string;
    value: number;
    route: string;
}

/**
 * The sample in a beacon's body, or null if it is anything else: exactly the four fields, a
 * web-vitals ID, a known metric and kind of page, a finite value in range.
 */
export function parseVitals(input: unknown): VitalSample | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const row = input as Record<string, unknown>;
    const keys = Object.keys(row);
    if (keys.length !== 4 || keys.some(key => !['metricId', 'name', 'value', 'route'].includes(key)))
        return null;
    const { metricId, name, value, route } = row;
    if (typeof metricId !== 'string' || !METRIC_ID.test(metricId)) return null;
    if (typeof name !== 'string' || !METRICS.includes(name)) return null;
    if (typeof route !== 'string' || !ROUTES.includes(route)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    if (value > (name === 'CLS' ? MAX_CLS : MAX_MS)) return null;
    // Whole milliseconds; CLS to four decimals (more is noise).
    const rounded = name === 'CLS' ? Math.round(value * 10_000) / 10_000 : Math.round(value);
    return { metricId, name, value: rounded, route };
}

/**
 * The beacon's rate limits, counted in the cache Redis. If Redis can't be reached, each process
 * counts on its own (the limits still hold per process) and a warning is logged.
 */
@Injectable()
export class VitalsLimiter implements OnModuleDestroy {
    private readonly redis: Redis;
    private readonly shared: RateLimitStore;
    private readonly local = new MemoryRateLimitStore();

    constructor(@Inject(CACHE_OPTIONS) options: CachePurgeOptions) {
        // Connects on first use, so the worker opens no connection.
        this.redis = new Redis({
            ...options.redis,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            commandTimeout: 1000,
        });
        this.redis.on('error', () => undefined);
        this.shared = new RedisRateLimitStore(this.redis, `${options.redisKeyPrefix}:rl:`);
    }

    /** Counts one request; false when the rule's limit is used up. */
    async allow(key: string, rule: RateLimitRule): Promise<boolean> {
        try {
            return (await hitRateLimit(this.shared, key, rule)).allowed;
        } catch (error) {
            Logger.warn(
                `Speed beacon limits counted per process (Redis unavailable): ${String(error)}`,
                'Vitals',
            );
            return (await hitRateLimit(this.local, key, rule)).allowed;
        }
    }

    onModuleDestroy() {
        this.redis.disconnect();
    }
}

@Injectable()
export class VitalsService {
    constructor(private db: TransactionalConnection) {}

    /**
     * Stores one sample; false if the body isn't one. A repeated report of the same page view's
     * metric (web-vitals reports again when a value grows) updates its row, but only while it
     * still names the same metric, page kind and day. One statement against the unique index:
     * concurrent beacons don't wait for each other.
     */
    async record(ctx: RequestContext, input: unknown): Promise<boolean> {
        const sample = parseVitals(input);
        if (!sample) return false;
        const rows: unknown[] = await this.db.rawConnection.query(
            `INSERT INTO cache_vital_sample ("channelId", "metricId", name, value, route, day)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ("channelId", "metricId") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()
             WHERE cache_vital_sample.name = EXCLUDED.name
               AND cache_vital_sample.route = EXCLUDED.route
               AND cache_vital_sample.day = EXCLUDED.day
             RETURNING id`,
            [
                Number(ctx.channelId),
                // A hash, so the page view's load time inside web-vitals' ID is not kept.
                createHash('sha256').update(sample.metricId).digest('hex').slice(0, 40),
                sample.name,
                sample.value,
                sample.route,
                dhakaDateKey(new Date()),
            ],
        );
        return rows.length > 0;
    }

    /** Per Dhaka day, metric and kind of page: the number of samples and the 75th percentile. */
    async daily(ctx: RequestContext) {
        const since = dhakaDateKey(new Date(Date.now() - (REPORT_DAYS - 1) * 86_400_000));
        return this.db.getRepository(ctx, CacheVitalSample).query(
            `SELECT day, name, route, COUNT(*)::int AS samples,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
             FROM cache_vital_sample
             WHERE "channelId" = $1 AND day >= $2
             GROUP BY day, name, route ORDER BY day DESC, name, route`,
            [Number(ctx.channelId), since],
        );
    }

    /** Deletes samples from before the days kept (Dhaka days, like the rows). */
    async cleanup() {
        await this.db.rawConnection.query('DELETE FROM cache_vital_sample WHERE day < $1', [
            dhakaDateKey(new Date(Date.now() - KEEP_DAYS * 86_400_000)),
        ]);
    }
}

/** The address a limit is counted against, hashed: the counter key never holds the IP itself. */
function addressKey(req: Request): string {
    return createHash('sha256')
        .update(req.ip ?? 'unknown')
        .digest('hex')
        .slice(0, 16);
}

@Controller('cache-metrics')
export class VitalsController {
    constructor(
        private vitals: VitalsService,
        private limiter: VitalsLimiter,
        @Inject(CACHE_OPTIONS) private options: CachePurgeOptions,
    ) {}

    /**
     * One beacon. In order: the Origin must be the store's (this stops other sites' pages from
     * posting through their visitors' browsers; a script can still forge it, which is what the
     * limits are for), the visitor's address must be under its limits, the body must be one valid
     * sample (Express reads at most 512 bytes of JSON, see cache-purge.plugin.ts), and the store
     * under its own. Invalid bodies count against the address, so garbage can't be sent freely.
     */
    @Post()
    @Allow(Permission.Public)
    async record(
        @Ctx() ctx: RequestContext,
        @Body() body: unknown,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        res.setHeader('Cache-Control', 'no-store');
        const origin = this.options.storefrontUrl ? new URL(this.options.storefrontUrl).origin : null;
        if (!origin || req.headers.origin !== origin) return res.sendStatus(403);
        const address = addressKey(req);
        if (
            !(await this.limiter.allow(`vitals:ip:${address}`, VITALS_LIMITS.perAddress)) ||
            !(await this.limiter.allow(`vitals:ip-day:${address}`, VITALS_LIMITS.perAddressDaily))
        )
            return res.sendStatus(429);
        if (!parseVitals(body)) return res.sendStatus(400);
        const store = String(ctx.channelId);
        if (
            !(await this.limiter.allow(`vitals:store:${store}`, VITALS_LIMITS.perStore)) ||
            !(await this.limiter.allow(`vitals:store-day:${store}`, VITALS_LIMITS.perStoreDaily))
        )
            return res.sendStatus(429);
        return res.sendStatus((await this.vitals.record(ctx, body)) ? 204 : 400);
    }
}

@Resolver()
export class VitalsResolver {
    constructor(private vitals: VitalsService) {}

    /** Daily p75 per metric and kind of page, last 30 days (staff with ReadSettings). */
    @Query()
    @Allow(Permission.ReadSettings)
    cacheDailyVitals(@Ctx() ctx: RequestContext, @Args() _args: Record<string, never>) {
        return this.vitals.daily(ctx);
    }
}

import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import type { Request, Response } from 'express';
import { CacheVitalSample } from './entities';
import { CACHE_OPTIONS, CachePurgeOptions } from './options';
import { Injectable } from '@nestjs/common';

const routes = ['home', 'product', 'category', 'sales', 'page', 'search', 'checkout', 'cart', 'other'];
export function parseVitals(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const row = input as Record<string, unknown>;
    if (
        Object.keys(row).some(k => !['metricId', 'name', 'value', 'route'].includes(k)) ||
        typeof row.metricId !== 'string' ||
        !/^[a-zA-Z0-9-]{8,40}$/.test(row.metricId) ||
        typeof row.name !== 'string' ||
        !['LCP', 'INP', 'CLS'].includes(row.name) ||
        typeof row.value !== 'number' ||
        !Number.isFinite(row.value) ||
        row.value < 0 ||
        row.value > (row.name === 'CLS' ? 10 : 60000) ||
        typeof row.route !== 'string' ||
        !routes.includes(row.route)
    )
        return null;
    return { metricId: row.metricId, name: String(row.name), value: row.value, route: String(row.route) };
}
@Injectable()
export class VitalsService {
    constructor(private db: TransactionalConnection) {}
    async record(ctx: RequestContext, input: unknown) {
        const sample = parseVitals(input);
        if (!sample) return false;
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
        return this.db.withTransaction(ctx, async tx => {
            const repo = this.db.getRepository(tx, CacheVitalSample);
            await repo.query('SELECT pg_advisory_xact_lock($1,$2)', [1717, Number(ctx.channelId)]);
            const old = await repo.findOneBy({ channelId: Number(ctx.channelId), metricId: sample.metricId });
            if (old && (old.name !== sample.name || old.route !== sample.route || old.day !== day))
                return false;
            // A sampled visitor sends at most three measurements. Total ingestion is bounded per day.
            if (!old && (await repo.countBy({ channelId: Number(ctx.channelId), day })) >= 50000)
                return false;
            await repo.save(
                new CacheVitalSample({ ...old, ...sample, day, channelId: Number(ctx.channelId) }),
            );
            return true;
        });
    }
    async daily(ctx: RequestContext) {
        return this.db.getRepository(ctx, CacheVitalSample).query(
            `SELECT day, name, route, COUNT(*)::int AS samples,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75 FROM cache_vital_sample
            WHERE "channelId"=$1 AND day >= $2 GROUP BY day,name,route ORDER BY day DESC,name,route`,
            [Number(ctx.channelId), new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)],
        );
    }
    async cleanup() {
        await this.db.rawConnection.query('DELETE FROM cache_vital_sample WHERE day < $1', [
            new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10),
        ]);
    }
}
@Controller('cache-metrics')
export class VitalsController {
    private minute = 0;
    private received = 0;
    constructor(
        private vitals: VitalsService,
        @Inject(CACHE_OPTIONS) private options: CachePurgeOptions,
    ) {}
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
        const minute = Math.floor(Date.now() / 60000);
        if (minute !== this.minute) {
            this.minute = minute;
            this.received = 0;
        }
        if (++this.received > 1200) return res.sendStatus(429);
        return res.sendStatus((await this.vitals.record(ctx, body)) ? 204 : 400);
    }
}
@Resolver()
export class VitalsResolver {
    constructor(private vitals: VitalsService) {}
    @Query()
    @Allow(Permission.ReadSettings)
    cacheDailyVitals(@Ctx() ctx: RequestContext, @Args() _args: Record<string, never>) {
        return this.vitals.daily(ctx);
    }
}

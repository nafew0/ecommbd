import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHttpClient } from '@ecommbd/shared';
import { WooSource } from './entities';
import { WooMiss, WooRedirect } from './helper-entities';
import { migrationPath, safeMigrationTarget } from './urls';

@Injectable()
export class WooRedirectService {
    constructor(private connection: TransactionalConnection) {}
    async save(ctx: RequestContext, sourceId: number, path: string, target: string | null, status = 301) {
        if (![301, 410].includes(status) || (status === 301 && !target))
            throw new UserInputError('error.woo-import.input');
        path = migrationPath(path);
        target = target === null ? null : safeMigrationTarget(target);
        if (
            /^\/(?:admin|admin-api|shop-api|woo-migrate|dashboard|checkout|cart|t|track)(?:\/|\?|$)/.test(
                path,
            )
        )
            throw new UserInputError('error.woo-import.input');
        const repo = this.connection.getRepository(ctx, WooRedirect);
        const visited = new Set([path]);
        let final = target;
        for (let depth = 0; final; depth++) {
            if (visited.has(final) || depth > 20) throw new UserInputError('error.woo-import.redirectLoop');
            visited.add(final);
            const next = await repo.findOneBy({ channelId: Number(ctx.channelId), path: final });
            if (!next) break;
            if (next.status === 410) {
                status = 410;
                final = null;
                break;
            }
            final = next.target;
        }
        const old = await repo.findOneBy({ channelId: Number(ctx.channelId), path });
        const saved = await repo.save(
            new WooRedirect({
                ...old,
                channelId: Number(ctx.channelId),
                sourceId,
                path,
                target: final,
                status,
            }),
        );
        // Earlier inbound rules point straight to the new terminal target, never through a chain.
        await repo.update({ channelId: Number(ctx.channelId), target: path }, { target: final, status });
        return saved;
    }
    async resolve(ctx: RequestContext, raw: string, recordMiss = false) {
        if (typeof raw !== 'string' || raw.length > 1000) return null;
        let path: string;
        try {
            path = migrationPath(raw);
        } catch {
            return null;
        }
        const repo = this.connection.getRepository(ctx, WooRedirect);
        const row = await repo.findOneBy({ channelId: Number(ctx.channelId), path });
        if (row) {
            await repo.increment({ id: row.id }, 'hits', 1);
            return { status: row.status, target: row.target };
        }
        if (path === '/feed/') return { status: 410, target: null };
        if (/^\/(?:sitemap_index|wp-sitemap|product-sitemap|page-sitemap)\d*\.xml$/.test(path))
            return { status: 301, target: '/sitemap.xml' };
        if (
            recordMiss &&
            raw.length <= 1000 &&
            !/^\/(?:admin|api|checkout|cart|t|track|assets|img)/.test(path)
        ) {
            // Bound public counters and keep no query data other than explicit legacy selectors.
            const misses = this.connection.getRepository(ctx, WooMiss);
            if ((await misses.countBy({ channelId: Number(ctx.channelId) })) < 5000)
                await misses.query(
                    'INSERT INTO woo_miss ("channelId",path,hits) VALUES ($1,$2,1) ON CONFLICT ("channelId",path) DO UPDATE SET hits=woo_miss.hits+1,"updatedAt"=now()',
                    [Number(ctx.channelId), path],
                );
        }
        return null;
    }
    async list(ctx: RequestContext, sourceId: number) {
        return {
            redirects: await this.connection.getRepository(ctx, WooRedirect).find({
                where: { channelId: Number(ctx.channelId), sourceId },
                order: { hits: 'DESC' },
                take: 100,
            }),
            misses: await this.connection
                .getRepository(ctx, WooMiss)
                .find({ where: { channelId: Number(ctx.channelId) }, order: { hits: 'DESC' }, take: 100 }),
        };
    }
    async crawl(ctx: RequestContext, source: WooSource, destination: string, sitemap: string) {
        const base = new URL(destination);
        const origin = new URL(source.url);
        if (base.protocol !== 'https:' || new URL(sitemap).origin !== origin.origin)
            throw new UserInputError('error.woo-import.input');
        const client = createHttpClient({
            maxResponseBytes: 2 * 1024 * 1024,
            maxRedirects: 0,
            maxRetries: 1,
            timeoutMs: 10000,
        });
        const pending = [sitemap];
        const seen = new Set<string>();
        const results: Array<{ path: string; status: number; ok: boolean }> = [];
        try {
            while (pending.length && seen.size < 20 && results.length < 2000) {
                const url = pending.shift()!;
                if (seen.has(url)) continue;
                seen.add(url);
                if (new URL(url).origin !== origin.origin) throw new Error('SITEMAP_HOST_CHANGED');
                const response = await client.request(url);
                if (response.status !== 200) throw new Error('SITEMAP_READ_FAILED');
                const xml = response.body.toString('utf8');
                if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('UNSAFE_SITEMAP');
                for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
                    const old = new URL(match[1].trim().replace(/&amp;/g, '&'));
                    if (old.origin !== origin.origin) continue;
                    if (/<sitemapindex[\s>]/.test(xml)) {
                        pending.push(old.href);
                        continue;
                    }
                    const path = migrationPath(old.pathname + old.search);
                    // Check the actual source spelling too, so normalization cannot hide a chain.
                    const first = new URL(old.pathname + old.search, base);
                    let checked = await client.request(first);
                    if (checked.status === 301) {
                        const location = checked.headers.get('location');
                        if (location) {
                            const next = new URL(location, first);
                            if (next.origin === base.origin) checked = await client.request(next);
                        }
                    }
                    results.push({ path, status: checked.status, ok: checked.status === 200 });
                    if (results.length >= 2000) break;
                }
            }
            const truncated = pending.length > 0 || results.length >= 2000;
            return {
                results,
                checked: results.length,
                passed: !truncated && results.length > 0 && results.every(r => r.ok),
                truncated,
                at: new Date().toISOString(),
            };
        } finally {
            await client.close();
        }
    }
}

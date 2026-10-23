import { Injectable } from '@nestjs/common';
import {
    CollectionTranslation,
    ProductTranslation,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHttpClient, POLICY_SLUGS } from '@ecommbd/shared';
import { IsNull } from 'typeorm';
import { BdPageTranslation } from '../bd-content';
import { WooSource } from './entities';
import { WooMiss, WooRedirect } from './helper-entities';
import { migrationPath, MISS_EXCLUDED, RESERVED_SOURCE, safeMigrationTarget } from './urls';

/** How many missing paths a store keeps, and how many of the least-asked-for go when it's full. */
const MISS_LIMIT = 5000;
const MISS_EVICT = 500;

/** What an import does with one old address. */
export type ImportedRule = 'saved' | 'same' | 'kept';

/**
 * Old WooCommerce addresses (roadmap phase 22): the redirect table, the "missing pages" list and
 * the sitemap crawler that checks them before cutover.
 *
 * Paths and targets are normalized with `migrationPath` (decoded, NFC, lowercase, trailing slash),
 * so `/Shop/Shirt` and `/shop/shirt/` are one rule. The storefront asks for a rule only when it
 * has no page of its own for the path (apps/storefront/src/middleware.ts), so a rule can never
 * hide a working page; WordPress's query links (`/?p=123`) are the one exception.
 */
@Injectable()
export class WooRedirectService {
    constructor(private connection: TransactionalConnection) {}

    /**
     * Saves a rule from the cutover screen. Staff rules are marked `manual`, so later imports
     * leave them alone. Refuses our own addresses, and loops (a rule that leads back to itself).
     */
    async save(ctx: RequestContext, sourceId: number, path: string, target: string | null, status = 301) {
        return this.store(ctx, sourceId, path, target, status, true);
    }

    /**
     * Saves a rule found during an import. Returns:
     * - `same` when the old address is already the new one (WordPress `/product/shirt` and ours
     *   `/product/shirt/` differ only by a slash): no rule is needed, and saving one would loop;
     * - `kept` when staff already set this path by hand: their rule wins over the source's;
     * - `saved` otherwise.
     * Throws (a `UserInputError`) for a rule we refuse; the importer records an issue and goes on.
     */
    async importRule(
        ctx: RequestContext,
        sourceId: number,
        path: string,
        target: string | null,
        status = 301,
    ): Promise<ImportedRule> {
        let from: string;
        let to: string | null;
        try {
            from = migrationPath(path);
            to = target === null ? null : safeMigrationTarget(target);
        } catch {
            throw new UserInputError('error.woo-import.input');
        }
        if (status === 301 && to === from) return 'same';
        const existing = await this.connection
            .getRepository(ctx, WooRedirect)
            .findOneBy({ channelId: Number(ctx.channelId), path: from });
        if (existing?.manual) return 'kept';
        await this.store(ctx, sourceId, from, to, status, false);
        return 'saved';
    }

    private async store(
        ctx: RequestContext,
        sourceId: number,
        rawPath: string,
        rawTarget: string | null,
        requestedStatus: number,
        manual: boolean,
    ) {
        let status = requestedStatus;
        if (![301, 410].includes(status) || (status === 301 && !rawTarget))
            throw new UserInputError('error.woo-import.input');
        let path: string;
        let target: string | null;
        try {
            path = migrationPath(rawPath);
            target = rawTarget === null || status === 410 ? null : safeMigrationTarget(rawTarget);
        } catch {
            throw new UserInputError('error.woo-import.input');
        }
        if (RESERVED_SOURCE.test(path)) throw new UserInputError('error.woo-import.input');
        const repo = this.connection.getRepository(ctx, WooRedirect);
        // Follow the target through existing rules to where it really ends, so shoppers get one
        // 301, never a chain; meeting the starting path again (or 20 hops) is a loop. A target
        // that is one of our live pages is where it ends, whatever rule it may have: the
        // storefront serves the page and never uses that rule.
        const visited = new Set([path]);
        let final = target;
        for (let depth = 0; final; depth++) {
            if (visited.has(final) || depth > 20) throw new UserInputError('error.woo-import.redirectLoop');
            visited.add(final);
            if (await this.isLiveAddress(ctx, final)) break;
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
                manual: manual || !!old?.manual,
            }),
        );
        // Earlier rules that pointed at this path now point straight at its final target, unless
        // this path is a live page of ours: then they keep pointing at the page, and this rule
        // simply never fires.
        if (!(await this.isLiveAddress(ctx, path)))
            await repo.update({ channelId: Number(ctx.channelId), target: path }, { target: final, status });
        return saved;
    }

    /**
     * Whether a normalized path is one of the store's own pages: a product, a category (by its
     * last segment), a content page or a policy page, in either language (`/en/…`). These are
     * the addresses the storefront answers itself, before any rule (see the class comment).
     */
    private async isLiveAddress(ctx: RequestContext, path: string): Promise<boolean> {
        const segments = path
            .replace(/\?.*$/, '')
            .split('/')
            .filter(Boolean)
            .map(segment => decodeURIComponent(segment));
        if (segments[0] === 'en' || segments[0] === 'bn') segments.shift();
        // Vendure keeps slugs decomposed (NFD); paths are composed (NFC).
        const slug = segments[segments.length - 1]?.normalize('NFD');
        if (!slug) return false;
        if (segments[0] === 'product' && segments.length === 2)
            return this.connection
                .getRepository(ctx, ProductTranslation)
                .exists({ where: { slug, base: { deletedAt: IsNull(), enabled: true } } });
        if (segments[0] === 'product-category' && segments.length >= 2)
            return this.connection.getRepository(ctx, CollectionTranslation).exists({ where: { slug } });
        if (segments.length !== 1) return false;
        if (Object.values(POLICY_SLUGS).includes(slug.normalize('NFC'))) return true;
        return this.connection
            .getRepository(ctx, BdPageTranslation)
            .exists({ where: { slug, page: { enabled: true } } });
    }

    /** Removes one rule (staff only; the cutover screen asks first). */
    async remove(ctx: RequestContext, id: number) {
        const result = await this.connection
            .getRepository(ctx, WooRedirect)
            .delete({ id, channelId: Number(ctx.channelId) });
        return !!result.affected;
    }

    /**
     * The rule for an old address, for the storefront. With `recordMiss`, a path with no rule is
     * counted for the "missing pages" list (the storefront only asks after its own 404).
     */
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
        // WordPress's feeds (the site's, a category's, comments) have no equivalent here: Gone.
        if (/^\/(?:.+\/)?feed\/(?:(?:rss2?|atom|rdf)\/)?$/.test(path)) return { status: 410, target: null };
        // Yoast, RankMath and WordPress's own sitemaps (sitemap_index.xml, product-sitemap.xml,
        // product_cat-sitemap2.xml, wp-sitemap-posts-page-1.xml…) all become our one sitemap.
        if (/^\/(?:sitemap_index|wp-sitemap[a-z0-9_-]*|[a-z0-9_]+-sitemap\d*)\.xml$/.test(path))
            return { status: 301, target: '/sitemap.xml' };
        if (recordMiss && !MISS_EXCLUDED.test(path)) await this.recordMiss(ctx, path);
        return null;
    }

    /**
     * Counts one missing path. The list is public input (any visitor can make a 404), so it's
     * bounded: at the limit, the least-asked-for, oldest paths make room. Real broken links
     * collect hits and stay; one-off junk from bots is what gets dropped.
     */
    private async recordMiss(ctx: RequestContext, path: string) {
        const channelId = Number(ctx.channelId);
        const misses = this.connection.getRepository(ctx, WooMiss);
        if ((await misses.countBy({ channelId })) >= MISS_LIMIT)
            await misses.query(
                `DELETE FROM woo_miss WHERE id IN (
                    SELECT id FROM woo_miss WHERE "channelId" = $1 ORDER BY hits ASC, "updatedAt" ASC LIMIT $2)`,
                [channelId, MISS_EVICT],
            );
        await misses.query(
            `INSERT INTO woo_miss ("channelId", path, hits) VALUES ($1, $2, 1)
             ON CONFLICT ("channelId", path) DO UPDATE SET hits = woo_miss.hits + 1, "updatedAt" = now()`,
            [channelId, path],
        );
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

    /**
     * Checks every URL in the old store's sitemaps against the new store: each must answer 200,
     * or one 301 to a page that answers 200. Bounded (20 sitemap files, 2,000 URLs) and says when
     * it was cut short. A URL that can't be checked counts as a failure in the list; it never
     * stops the crawl. Only reading a sitemap itself can fail the whole crawl.
     */
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
                const isIndex = /<sitemapindex[\s>]/.test(xml);
                for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
                    let old: URL;
                    try {
                        old = new URL(match[1].trim().replace(/&amp;/g, '&'));
                    } catch {
                        continue; // Not a URL at all: nothing to check.
                    }
                    if (old.origin !== origin.origin) continue;
                    if (isIndex) {
                        pending.push(old.href);
                        continue;
                    }
                    results.push(await this.check(client, base, old));
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

    /** One old URL on the new store: 200, or a single same-site 301 to a 200. Status 0 = no answer. */
    private async check(client: ReturnType<typeof createHttpClient>, base: URL, old: URL) {
        let path = old.pathname + old.search;
        try {
            path = migrationPath(path);
            // Request the source's own spelling, so our normalization can't hide a redirect chain.
            const first = new URL(old.pathname + old.search, base);
            let checked = await client.request(first);
            if (checked.status === 301) {
                const location = checked.headers.get('location');
                const next = location ? new URL(location, first) : null;
                if (next && next.origin === base.origin) checked = await client.request(next);
            }
            return { path, status: checked.status, ok: checked.status === 200 };
        } catch {
            return { path: path.slice(0, 1000), status: 0, ok: false };
        }
    }
}

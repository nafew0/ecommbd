import type { ConfigService, RequestContext } from '@vendure/core';

/**
 * An image's address for the admin's lists, as Vendure gives it on its own `Asset` fields. Vendure's
 * API completes only those (with ASSET_URL_PREFIX, or the request's host in dev); a `preview` string
 * in our own types would otherwise stay a bare path like `preview/a3/photo.jpg` and not load.
 */
export function assetUrl(
    config: ConfigService,
    ctx: RequestContext,
    identifier: string | null | undefined,
): string | null {
    if (!identifier) return null;
    const strategy = config.assetOptions.assetStorageStrategy;
    return strategy.toAbsoluteUrl && ctx.req ? strategy.toAbsoluteUrl(ctx.req, identifier) : identifier;
}

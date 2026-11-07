import { env } from '../env';

/**
 * Old WooCommerce links after a migration (roadmap phases 21–22). The core keeps the redirect
 * table; the middleware asks it only when the store itself has no page for the path, or for
 * WordPress's query links below.
 */

/** A rule found for an old link: a 301 to one of our pages, or 410 for something gone for good. */
export interface LegacyAnswer {
    status: number;
    target: string | null;
}

/** WordPress's query links (`/?p=123`, `/?product=slug`, `/?attachment_id=9`), which reach our home page. */
export function isLegacyQueryLink(search: URLSearchParams): boolean {
    return search.has('p') || search.has('product') || search.has('attachment_id');
}

/**
 * Looks an old link up in the core. With `recordMiss`, a link with no rule is counted for the
 * merchant's list of missing pages (the request already answered 404 here).
 *
 * A failed lookup never breaks the page: the shopper keeps the page (or the 404) they would have
 * had without a migration, and the failure is logged. (A plain fetch rather than `shopQuery`:
 * `wooResolvePath` answers JSON, and its failures must not become the "unavailable" page.)
 */
export async function legacyUrl(path: string, recordMiss = false): Promise<LegacyAnswer | null> {
    const settings = env();
    try {
        const response = await fetch(`${settings.CORE_URL}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: 'query($path:String!,$recordMiss:Boolean){wooResolvePath(path:$path,recordMiss:$recordMiss)}',
                variables: { path, recordMiss },
            }),
            signal: AbortSignal.timeout(settings.CORE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as {
            data?: { wooResolvePath: LegacyAnswer | null };
            errors?: unknown;
        };
        if (data.errors || !data.data) throw new Error('GraphQL error');
        return data.data.wooResolvePath;
    } catch (error) {
        // The path itself stays out of the log: old links can carry tracking or personal data.
        console.error(JSON.stringify({ level: 'warn', msg: 'old link lookup failed', error: String(error) }));
        return null;
    }
}

/**
 * The response for a rule, or null to carry on: a 410, or a 301 to our page. A rule that would
 * send the shopper back to the same address is ignored rather than looping.
 *
 * Shared caches never keep these (`private`), so every hit reaches the core and is counted, and a
 * rule the merchant edits takes effect at once; a browser may reuse one for an hour.
 */
export function legacyRedirect(answer: LegacyAnswer | null, requested: string): Response | null {
    const headers = { 'cache-control': 'private, max-age=3600' };
    if (answer?.status === 410) return new Response(null, { status: 410, headers });
    if (answer?.status === 301 && answer.target && answer.target !== requested) {
        return new Response(null, { status: 301, headers: { ...headers, location: answer.target } });
    }
    return null;
}

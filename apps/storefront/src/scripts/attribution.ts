import { ATTRIBUTION_COOKIE, ATTRIBUTION_DAYS, visitAttribution } from '@ecommbd/shared/attribution';

/**
 * Where the shopper came from (roadmap phase 16), on every page. Cached pages can't read the query
 * string on the server, so this does: a visit from an ad or another site (UTM values, a click ID,
 * an outside referrer) replaces what's stored, for 30 days; a direct visit leaves it alone (last
 * non-direct touch wins). The cookie is first-party and read by the server when an order is placed.
 */
export function recordVisit() {
    const visit = visitAttribution(
        new URL(location.href),
        document.referrer,
        location.hostname,
        document.body.dataset.salesPage ?? '',
    );
    if (!visit) return;
    let value = encodeURIComponent(JSON.stringify(visit));
    // Long Bangla UTM values grow when encoded: keep the cookie well under the browser's limit.
    if (value.length > 3000) value = encodeURIComponent(JSON.stringify({ ...visit, term: '', content: '' }));
    if (value.length > 3000) return;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ATTRIBUTION_COOKIE}=${value}; Path=/; Max-Age=${ATTRIBUTION_DAYS * 86400}; SameSite=Lax${secure}`;
}

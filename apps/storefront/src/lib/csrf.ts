import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/**
 * Form safety for cart, checkout and tracking posts (roadmap phase 14):
 * - every post must come from this site (`Sec-Fetch-Site`, else `Origin`); cookies are SameSite=Lax;
 * - the checkout form also carries an HMAC of the shopper's session cookie (no server storage);
 * - a signed timestamp says when the form was rendered, for the core's "too fast to be a person"
 *   check, measured on the server so a wrong phone clock doesn't matter.
 */

const sign = (purpose: string, value: string) =>
    createHmac('sha256', env().CSRF_SECRET).update(`${purpose}:${value}`).digest('base64url');

function same(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether a POST comes from a page of this site. Browsers without these headers rely on SameSite. */
export function isSameSite(request: Request): boolean {
    const site = request.headers.get('sec-fetch-site');
    if (site) return site === 'same-origin' || site === 'none';
    const origin = request.headers.get('origin');
    if (!origin || origin === 'null') return origin !== 'null';
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
    try {
        const url = new URL(origin);
        return url.host === host || url.origin === new URL(env().SITE_URL).origin;
    } catch {
        return false;
    }
}

export function csrfToken(sessionId: string | undefined): string {
    return sign('csrf', sessionId ?? 'new');
}

export function verifyCsrf(token: unknown, sessionId: string | undefined): boolean {
    return typeof token === 'string' && same(token, csrfToken(sessionId));
}

/** `<time>.<signature>`, rendered into the form. */
export function formStamp(now = Date.now()): string {
    const time = String(now);
    return `${time}.${sign('stamp', time)}`;
}

/** Seconds since the form was rendered; 0 for a missing or forged stamp (the core then refuses). */
export function secondsSinceStamp(stamp: unknown, now = Date.now()): number {
    if (typeof stamp !== 'string') return 0;
    const [time = '', signature = ''] = stamp.split('.');
    if (!/^\d{10,16}$/.test(time) || !same(signature, sign('stamp', time))) return 0;
    return Math.max(0, Math.min(Math.floor((now - Number(time)) / 1000), 24 * 60 * 60));
}

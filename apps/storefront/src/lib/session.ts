import { env } from '../env';

/**
 * The shopper's Vendure session (roadmap phase 14). Cart and checkout routes call the core with the
 * shopper's `shop-session` cookies and pass Vendure's cookies back to the browser, with a 30-day
 * lifetime that starts again on every cart or checkout visit (Vendure's own cookie options can't
 * give only the shop cookie a lifetime). The cookies stay HttpOnly: no script ever sees them.
 */

export const SESSION_COOKIE = 'shop-session';
const NAMES = [SESSION_COOKIE, `${SESSION_COOKIE}.sig`];
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** The value of each cookie in a `Cookie` header. */
export function parseCookies(header: string | null): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const part of (header ?? '').split(';')) {
        const index = part.indexOf('=');
        if (index < 1) continue;
        const name = part.slice(0, index).trim();
        if (!cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
    }
    return cookies;
}

function cookieLine(name: string, value: string, maxAge: number, httpOnly = true): string {
    const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax'];
    if (httpOnly) parts.push('HttpOnly');
    if (env().SECURE_COOKIES) parts.push('Secure');
    return parts.join('; ');
}

export class ShopSession {
    private readonly values = new Map<string, string>();
    private readonly outgoing = new Map<string, string>();

    constructor(cookieHeader: string | null) {
        const cookies = parseCookies(cookieHeader);
        for (const name of NAMES) {
            const value = cookies.get(name);
            if (value) this.values.set(name, value);
        }
    }

    /** The cookies to send to the core, or undefined for a new shopper. */
    get cookieHeader(): string | undefined {
        if (!this.values.size) return undefined;
        return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    /** The session's identity for the CSRF token (the signed cookie value), or undefined. */
    get id(): string | undefined {
        return this.values.get(SESSION_COOKIE);
    }

    /** Takes the core's `Set-Cookie` headers: our session cookies are kept and passed on with a lifetime. */
    absorb(setCookies: string[]) {
        for (const line of setCookies) {
            const [pair = ''] = line.split(';');
            const index = pair.indexOf('=');
            const name = pair.slice(0, index).trim();
            if (!NAMES.includes(name)) continue;
            const value = pair.slice(index + 1).trim();
            // An expired cookie (the core ended the session) is passed on as a deletion.
            if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) {
                this.values.delete(name);
                this.outgoing.set(name, cookieLine(name, '', 0));
                continue;
            }
            this.values.set(name, value);
            this.outgoing.set(name, cookieLine(name, value, SESSION_MAX_AGE));
        }
    }

    /** Adds the cookies for the browser: new ones from the core, else the current ones again (30 days from now). */
    apply(headers: Headers) {
        for (const [name, value] of this.values) {
            if (!this.outgoing.has(name)) this.outgoing.set(name, cookieLine(name, value, SESSION_MAX_AGE));
        }
        for (const line of this.outgoing.values()) headers.append('set-cookie', line);
    }
}

/** The cart's item count for the header, readable by the page's script (not secret). */
export function cartCountCookie(count: number): string {
    return cookieLine(
        'cart_count',
        String(Math.max(0, Math.min(count, 999))),
        count > 0 ? SESSION_MAX_AGE : 0,
        false,
    );
}

/** The order this browser placed last, for the back button and other tabs (2 hours). */
export const LAST_ORDER_COOKIE = 'last_order';

export function lastOrderCookie(code: string): string {
    return cookieLine(LAST_ORDER_COOKIE, code, 2 * 60 * 60);
}

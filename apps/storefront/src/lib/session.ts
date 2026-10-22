import { env } from '../env';

/**
 * The shopper's Vendure session (roadmap phase 14). Cart and checkout routes call the core with the
 * shopper's `shop-session` cookies and pass Vendure's cookies back to the browser, with a 30-day
 * lifetime that starts again on every cart or checkout visit (Vendure's own cookie options can't
 * give only the shop cookie a lifetime). The cookies stay HttpOnly: no script ever sees them.
 */

export const SESSION_COOKIE = 'shop-session';
/** Sales pages (phase 16) order in a session of their own, so the shopper's cart is left alone. */
export const SALES_SESSION_COOKIE = 'lp-session';
/** The core's cookie names; the browser's may differ (`lp-session`). */
const CORE_NAMES = [SESSION_COOKIE, `${SESSION_COOKIE}.sig`];
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
    /** By the core's cookie names. */
    private readonly values = new Map<string, string>();
    /** By the browser's cookie names. */
    private readonly outgoing = new Map<string, string>();
    /** The browser's name for each of the core's cookies. */
    private readonly browserName: (coreName: string) => string;

    constructor(cookieHeader: string | null, browserCookie = SESSION_COOKIE) {
        this.browserName = name => name.replace(SESSION_COOKIE, browserCookie);
        const cookies = parseCookies(cookieHeader);
        for (const name of CORE_NAMES) {
            const value = cookies.get(this.browserName(name));
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

    /** Whether the browser sent a session (a new shopper hasn't one). */
    get exists(): boolean {
        return this.values.size > 0;
    }

    /** Takes the core's `Set-Cookie` headers: our session cookies are kept and passed on with a lifetime. */
    absorb(setCookies: string[]) {
        for (const line of setCookies) {
            const [pair = ''] = line.split(';');
            const index = pair.indexOf('=');
            const name = pair.slice(0, index).trim();
            if (!CORE_NAMES.includes(name)) continue;
            const value = pair.slice(index + 1).trim();
            const browser = this.browserName(name);
            // An expired cookie (the core ended the session) is passed on as a deletion.
            if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) {
                this.values.delete(name);
                this.outgoing.set(browser, cookieLine(browser, '', 0));
                continue;
            }
            this.values.set(name, value);
            this.outgoing.set(browser, cookieLine(browser, value, SESSION_MAX_AGE));
        }
    }

    /** Adds the cookies for the browser: new ones from the core, else the current ones again (30 days from now). */
    apply(headers: Headers) {
        for (const [name, value] of this.values) {
            const browser = this.browserName(name);
            if (!this.outgoing.has(browser))
                this.outgoing.set(browser, cookieLine(browser, value, SESSION_MAX_AGE));
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

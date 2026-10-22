import { describe, expect, it } from 'vitest';
import { formInteger } from '../src/lib/cart';
import { readValues } from '../src/lib/checkout';
import { csrfToken, formStamp, isSameSite, secondsSinceStamp, verifyCsrf } from '../src/lib/csrf';
import { cartCountCookie, parseCookies, ShopSession } from '../src/lib/session';

describe('the shopper session (Vendure cookies passed through)', () => {
    it('sends only the shop session cookies to the core', () => {
        const session = new ShopSession(
            'cart_count=2; shop-session=abc; shop-session.sig=def; admin-session=x',
        );
        expect(session.cookieHeader).toBe('shop-session=abc; shop-session.sig=def');
        expect(session.id).toBe('abc');
        expect(new ShopSession(null).cookieHeader).toBeUndefined();
    });

    it('passes the core’s cookies on with a 30-day lifetime, HttpOnly and SameSite=Lax', () => {
        const session = new ShopSession(null);
        session.absorb([
            'shop-session=new; path=/; samesite=lax; httponly',
            'shop-session.sig=sig; path=/; samesite=lax; httponly',
            'other=1; path=/',
        ]);
        const headers = new Headers();
        session.apply(headers);
        expect(headers.getSetCookie()).toEqual([
            'shop-session=new; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly',
            'shop-session.sig=sig; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly',
        ]);
        expect(session.cookieHeader).toBe('shop-session=new; shop-session.sig=sig');
    });

    it('renews the current cookies for another 30 days, and passes on a deletion', () => {
        const renewed = new ShopSession('shop-session=abc; shop-session.sig=def');
        const headers = new Headers();
        renewed.apply(headers);
        expect(headers.getSetCookie()).toHaveLength(2);
        const ended = new ShopSession('shop-session=abc');
        ended.absorb(['shop-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; httponly']);
        const out = new Headers();
        ended.apply(out);
        expect(out.getSetCookie()).toEqual(['shop-session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly']);
        expect(ended.cookieHeader).toBeUndefined();
    });

    it('keeps a sales page session apart from the cart, under its own cookie', () => {
        const session = new ShopSession(
            'shop-session=cart; lp-session=sales; lp-session.sig=sig',
            'lp-session',
        );
        // The core knows one name; the browser keeps the two sessions apart.
        expect(session.cookieHeader).toBe('shop-session=sales; shop-session.sig=sig');
        expect(session.id).toBe('sales');
        session.absorb(['shop-session=next; path=/; httponly']);
        const headers = new Headers();
        session.apply(headers);
        expect(headers.getSetCookie()).toEqual([
            'lp-session=next; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly',
            'lp-session.sig=sig; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly',
        ]);
        expect(new ShopSession('shop-session=cart', 'lp-session').exists).toBe(false);
    });

    it('keeps the cart count readable by the page, and clears it at zero', () => {
        expect(cartCountCookie(3)).toBe('cart_count=3; Path=/; Max-Age=2592000; SameSite=Lax');
        expect(cartCountCookie(0)).toContain('Max-Age=0');
        expect(parseCookies('a=1; b=2=3')).toEqual(
            new Map([
                ['a', '1'],
                ['b', '2=3'],
            ]),
        );
    });
});

describe('form safety', () => {
    it('ties the CSRF token to the session', () => {
        const token = csrfToken('session-1');
        expect(verifyCsrf(token, 'session-1')).toBe(true);
        expect(verifyCsrf(token, 'session-2')).toBe(false);
        expect(verifyCsrf(undefined, 'session-1')).toBe(false);
        expect(verifyCsrf(`${token}x`, 'session-1')).toBe(false);
    });

    it('measures time since the form was rendered, and ignores a forged stamp', () => {
        const now = Date.now();
        expect(secondsSinceStamp(formStamp(now - 12_000), now)).toBe(12);
        expect(secondsSinceStamp(`${now - 60_000}.forged`, now)).toBe(0);
        expect(secondsSinceStamp('nonsense', now)).toBe(0);
        expect(secondsSinceStamp(undefined, now)).toBe(0);
    });

    it('accepts posts from this site only', () => {
        const post = (headers: Record<string, string>) =>
            new Request('http://localhost:4321/checkout/', { method: 'POST', headers });
        expect(isSameSite(post({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
        expect(isSameSite(post({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
        expect(isSameSite(post({ origin: 'http://localhost:4321', host: 'localhost:4321' }))).toBe(true);
        expect(isSameSite(post({ origin: 'https://evil.example', host: 'localhost:4321' }))).toBe(false);
        expect(isSameSite(post({ origin: 'null' }))).toBe(false);
        // Old browsers send neither: SameSite=Lax cookies protect them.
        expect(isSameSite(post({}))).toBe(true);
    });
});

describe('reading the checkout form', () => {
    it('takes the chosen mobile banking option’s own sender and TrxID', () => {
        const form = new FormData();
        form.set('payment', 'nagad');
        form.set('senderNumber.bkash', '01711111111');
        form.set('transactionId.bkash', 'BKASH1234');
        form.set('senderNumber.nagad', ' 01722222222 ');
        form.set('transactionId.nagad', 'NAGAD5678');
        const values = readValues(form);
        expect([values.senderNumber, values.transactionId]).toEqual(['01722222222', 'NAGAD5678']);
        expect(values.name).toBe('');
    });

    it('cuts very long values', () => {
        const form = new FormData();
        form.set('name', 'x'.repeat(5000));
        form.set('note', 'y'.repeat(5000));
        const values = readValues(form);
        expect(values.name).toHaveLength(300);
        expect(values.note).toHaveLength(1000);
    });

    it('reads quantities with Bangla digits and keeps them in range', () => {
        expect(formInteger('৩', 1, 99)).toBe(3);
        expect(formInteger('500', 1, 99)).toBe(99);
        expect(formInteger('0', 1, 99)).toBe(1);
        expect(formInteger('-2', 1, 99)).toBeNull();
        expect(formInteger(null, 1, 99)).toBeNull();
    });
});

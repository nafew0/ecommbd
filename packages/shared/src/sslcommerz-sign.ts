import { createHash } from 'node:crypto';

/** Node only (the merchant admin imports `online-payments` by path, so it stays browser-safe). */

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

/**
 * SSLCommerz's `verify_sign` on an IPN or return post: the fields named in `verify_key`, plus
 * `store_passwd` as the MD5 of the store password, sorted by name, joined as `a=1&b=2`, then MD5.
 * A failed check is a forged or altered post. A pass still isn't proof of payment: only the
 * validation API (with `val_id`) is.
 */
export function sslcommerzSignatureValid(fields: Record<string, unknown>, storePassword: string): boolean {
    const sign = fields.verify_sign;
    const key = fields.verify_key;
    if (typeof sign !== 'string' || typeof key !== 'string' || !sign || !key) return false;
    const names = key.split(',').filter(Boolean);
    const pairs: Record<string, string> = {};
    for (const name of names) {
        const value = fields[name];
        pairs[name] =
            typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
    }
    pairs.store_passwd = md5(storePassword);
    const text = Object.keys(pairs)
        .sort()
        .map(name => `${name}=${pairs[name]}`)
        .join('&');
    const expected = md5(text);
    return expected.length === sign.length && expected === sign.toLowerCase();
}

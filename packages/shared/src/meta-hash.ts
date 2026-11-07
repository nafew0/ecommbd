import { createHash } from 'node:crypto';
import { isPlaceholderEmail } from './placeholder-email';
import { metaCity, metaEmail, metaName, metaPhone } from './meta';

/** Node only (`meta.ts` stays browser-safe). SHA-256, hex, lower-case: what Meta expects. */
export function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface MetaCustomer {
    phone?: string | null;
    email?: string | null;
    fullName?: string | null;
    /** Our district's English name. */
    city?: string | null;
    /** A stable customer key (our customer ID). */
    externalId?: string | null;
}

/**
 * Meta's `user_data`, normalized then hashed. Placeholder emails of phone-only customers are never
 * sent; empty fields are left out. Country is always Bangladesh.
 */
export function hashedUserData(customer: MetaCustomer): Record<string, string[]> {
    const data: Record<string, string[]> = { country: [sha256('bd')] };
    const add = (key: string, value: string | null | undefined) => {
        if (value) data[key] = [sha256(value)];
    };
    add('ph', customer.phone ? metaPhone(customer.phone) : null);
    add('em', customer.email && !isPlaceholderEmail(customer.email) ? metaEmail(customer.email) : null);
    if (customer.fullName) {
        const { fn, ln } = metaName(customer.fullName);
        add('fn', fn);
        add('ln', ln);
    }
    add('ct', customer.city ? metaCity(customer.city) : null);
    add('external_id', customer.externalId);
    return data;
}

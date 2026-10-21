/**
 * Placeholder emails for phone-only customers.
 *
 * Vendure requires an email on every customer, so a shopper who checks out with only a phone gets
 * `<digits>@phone.invalid`. `.invalid` is a reserved top-level domain (RFC 2606): mail to it can
 * never be delivered. Every feature that shows or sends to an email (admin, SMS, email, exports,
 * Meta) checks `isPlaceholderEmail()` first.
 */

export const PLACEHOLDER_EMAIL_DOMAIN = 'phone.invalid';

/** `+8801712345678` → `8801712345678@phone.invalid` */
export function placeholderEmailFor(phoneE164: string): string {
    const digits = phoneE164.replace(/\D/g, '');
    if (digits === '') {
        throw new RangeError('A placeholder email needs a phone number');
    }
    return `${digits}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * True for any address on a `.invalid` domain, including the `Name <address>` form. Empty values
 * are not placeholders (there's simply no email).
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
    if (!email) {
        return false;
    }
    const address = (/<([^>]*)>\s*$/.exec(email)?.[1] ?? email).trim().toLowerCase();
    const at = address.lastIndexOf('@');
    if (at < 0) {
        return false;
    }
    const domain = address.slice(at + 1);
    return domain === 'invalid' || domain.endsWith('.invalid');
}

/** The email to show people: `null` when there is none or it's a placeholder. */
export function visibleEmail(email: string | null | undefined): string | null {
    return email && !isPlaceholderEmail(email) ? email : null;
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Preview tokens (roadmap phase 15): `<payload>.<signature>`, both base64url. The payload names the
 * layout, the store's channel, the kind (the editor's frame or a shared link) and the expiry; the
 * signature is HMAC-SHA256 with a key derived from COOKIE_SECRET, so nothing is stored and a token
 * can't be changed or reused on another store.
 */

export type PreviewMode = 'editor' | 'share';

export interface PreviewClaims {
    layoutId: string;
    channel: string;
    mode: PreviewMode;
    /** Seconds since 1970. */
    expires: number;
}

function key(secret: string): Buffer {
    return createHmac('sha256', secret).update('bd-sections preview token v1').digest();
}

function sign(payload: string, secret: string): string {
    return createHmac('sha256', key(secret)).update(payload).digest('base64url');
}

export function createPreviewToken(claims: PreviewClaims, secret: string): string {
    const payload = Buffer.from(
        JSON.stringify({ l: claims.layoutId, c: claims.channel, m: claims.mode, e: claims.expires }),
    ).toString('base64url');
    return `${payload}.${sign(payload, secret)}`;
}

/** The claims of a genuine, unexpired token for this channel; null for anything else. */
export function verifyPreviewToken(
    token: string,
    secret: string,
    channel: string,
    now = Date.now(),
): PreviewClaims | null {
    if (token.length > 400) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload, secret));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    const claims = raw as { l?: unknown; c?: unknown; m?: unknown; e?: unknown };
    if (
        typeof claims.l !== 'string' ||
        claims.c !== channel ||
        (claims.m !== 'editor' && claims.m !== 'share') ||
        typeof claims.e !== 'number' ||
        claims.e * 1000 <= now
    ) {
        return null;
    }
    return { layoutId: claims.l, channel: claims.c, mode: claims.m, expires: claims.e };
}

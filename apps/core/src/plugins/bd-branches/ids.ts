import { ConfigService, type ID } from '@vendure/core';

/** JSON keeps the id the admin was given (`T_1` in tests). A GraphQL ID argument is already raw. */
export function rawId(config: ConfigService, id: ID | null | undefined): number | null {
    if (id == null) return null;
    const value = String(id).trim();
    if (!value) return null;
    const direct = Number(value);
    if (Number.isInteger(direct) && direct > 0 && String(direct) === value) return direct;
    try {
        const decoded = config.entityIdStrategy.decodeId(value);
        if (typeof decoded === 'number' && decoded > 0) return decoded;
        if (typeof decoded === 'string' && /^\d+$/.test(decoded)) return Number(decoded);
    } catch {
        // Not an encoded id.
    }
    if (value.startsWith('T_')) {
        const stripped = Number(value.slice(2));
        if (Number.isInteger(stripped) && stripped > 0) return stripped;
    }
    return null;
}

/** The id the admin's selects use, so a saved setting matches a branch option. */
export function publicId(config: ConfigService, id: ID | null | undefined): string {
    const raw = rawId(config, id);
    if (raw == null) return '';
    return String(config.entityIdStrategy.encodeId(raw));
}

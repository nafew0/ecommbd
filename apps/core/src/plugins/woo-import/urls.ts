import { localPath } from './helpers';

/** Normalize once; encoded separators, control characters and protocol-relative URLs refuse. */
export function migrationPath(value: string): string {
    const url = new URL(localPath(value), 'https://migration.invalid');
    const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map(part => {
            const decoded = decodeURIComponent(part).normalize('NFC').toLowerCase();
            if (/[/\\?#]/.test(decoded) || Array.from(decoded).some(c => c.charCodeAt(0) <= 32))
                throw new Error('INVALID_LOCAL_PATH');
            return encodeURIComponent(decoded);
        });
    const path = segments.length
        ? '/' + segments.join('/') + (/\.[a-z0-9]{2,5}$/i.test(segments[segments.length - 1]) ? '' : '/')
        : '/';
    const query = new URLSearchParams();
    for (const key of ['p', 'product', 'attachment_id'])
        if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key)!);
    const result = path + (query.size ? '?' + query.toString() : '');
    if (result.length > 1000) throw new Error('INVALID_LOCAL_PATH');
    return result;
}
export function safeMigrationTarget(path: string) {
    const normalized = migrationPath(path);
    if (
        /^\/(?:admin|admin-api|shop-api|woo-migrate|dashboard|checkout|cart|t|track)(?:\/|\?|$)/.test(
            normalized,
        )
    )
        throw new Error('RESERVED_REDIRECT_PATH');
    return normalized;
}

import { type Fields, type LinkValue, readValue } from './fields';
import { isRecord } from './text';

/** Reading stored settings, shared by sections (document.ts) and the element tree (nodes.ts). */

export const UID = /^[a-z0-9]{4,24}$/;

/** A random ID for a new section, block or node (letters and digits). */
export function newId(): string {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => (byte % 36).toString(36)).join('');
}

/** An `href` the core resolved: a path on the store, an anchor or a web address. */
const SAFE_HREF = /^(\/(?!\/)|#|https?:\/\/)\S{0,500}$/;

export interface ReadOptions {
    /** Rich text is sanitized with this (the core and storefront pass `sanitizeRichText`). */
    sanitize?: (html: string) => string;
    /**
     * Keep the `href` the core added to links (the storefront, reading what the Shop API served).
     * Stored layouts never keep one: a link's address is always worked out again from its target.
     */
    keepHrefs?: boolean;
}

/** Stored settings read for a set of fields: unknown names dropped, wrong values made defaults. */
export function readSettings(fields: Fields, raw: Record<string, unknown>, options: ReadOptions) {
    const settings: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(fields)) {
        let value = readValue(definition, raw[name]);
        if (definition.kind === 'richText' && options.sanitize) {
            const text = value as { bn: string; en: string };
            value = { bn: text.bn && options.sanitize(text.bn), en: text.en && options.sanitize(text.en) };
        }
        const href = isRecord(raw[name]) ? (raw[name] as { href?: unknown }).href : undefined;
        if (
            definition.kind === 'link' &&
            options.keepHrefs &&
            typeof href === 'string' &&
            SAFE_HREF.test(href)
        ) {
            value = { ...(value as LinkValue), href };
        }
        settings[name] = value;
    }
    return settings;
}

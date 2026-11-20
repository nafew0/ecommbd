import type { LayoutDocument } from './define';
import {
    type NodeStyle,
    type NodeStyleValues,
    pasteStyle,
    readNodeStyle,
    styleGroupsFor,
} from './node-style';
import type { NodeData } from './nodes';
import { cleanText, isRecord } from './text';

/**
 * Saved styles (roadmap phase 62): a look with a name ("Big heading", "Order button") that
 * elements point to instead of each carrying their own copy. Change the saved style and every
 * element that uses it changes, on every page. They live in the theme settings, so they are the
 * store's, not one page's.
 */

export type SavedStyleKind = 'text' | 'button';

export interface SavedStyle {
    /** What elements point to. */
    key: string;
    name: string;
    kind: SavedStyleKind;
    style: NodeStyle;
}

export const SAVED_STYLE_LIMIT = 24;

const KEY = /^[a-z0-9]{6,12}$/;

/** A sample element of each kind: a saved style keeps only what that kind of element can show. */
const SAMPLE: Record<SavedStyleKind, string> = { text: 'heading', button: 'button' };

/** Which saved styles an element can use: button styles for buttons, text styles for text; null for neither. */
export function savedStyleKind(type: string): SavedStyleKind | null {
    const groups = styleGroupsFor(type).map(group => group.key);
    if (type === 'container' || type === 'live') return null;
    if (groups.includes('button')) return 'button';
    return groups.includes('typography') ? 'text' : null;
}

export function newStyleKey(): string {
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/** Stored saved styles read back: known kinds, checked values, unique keys, at most the limit. */
export function readSavedStyles(raw: unknown): SavedStyle[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const styles: SavedStyle[] = [];
    for (const item of raw) {
        if (!isRecord(item) || typeof item.key !== 'string' || !KEY.test(item.key) || seen.has(item.key)) {
            continue;
        }
        const kind = item.kind === 'button' ? 'button' : item.kind === 'text' ? 'text' : null;
        const name = typeof item.name === 'string' ? cleanText(item.name).slice(0, 40) : '';
        if (!kind || !name) continue;
        seen.add(item.key);
        styles.push({
            key: item.key,
            name,
            kind,
            style: pasteStyle(readNodeStyle(item.style), SAMPLE[kind]),
        });
        if (styles.length >= SAVED_STYLE_LIMIT) break;
    }
    return styles;
}

/** A saved style with an element's own choices on top: what the element has set itself wins. */
export function mergedStyle(saved: NodeStyle, own: NodeStyle): NodeStyle {
    const merged: NodeStyle = { base: { ...saved.base, ...own.base } };
    for (const device of ['tablet', 'phone'] as const) {
        const values: NodeStyleValues = { ...saved[device], ...own[device] };
        if (Object.keys(values).length) merged[device] = values;
    }
    return merged;
}

/**
 * The document with every element's saved style folded into its own, ready for the page's
 * stylesheet. An element pointing at a style that is gone, or of another kind, keeps its own look.
 */
export function withSavedStyles(document: LayoutDocument, styles: readonly SavedStyle[]): LayoutDocument {
    if (!styles.length) return document;
    const byKey = new Map(styles.map(style => [style.key, style]));
    let changed = false;
    const fold = (nodes: readonly NodeData[]): NodeData[] =>
        nodes.map(node => {
            const children = node.children ? fold(node.children) : undefined;
            const saved = node.styleRef ? byKey.get(node.styleRef) : undefined;
            const fits = saved && saved.kind === savedStyleKind(node.type);
            if (fits) changed = true;
            return {
                ...node,
                ...(fits ? { style: mergedStyle(pasteStyle(saved.style, node.type), node.style) } : {}),
                ...(children ? { children } : {}),
            };
        });
    const sections = document.sections.map(section =>
        section.children ? { ...section, children: fold(section.children) } : section,
    );
    return changed ? { sections } : document;
}

import type { SectionData } from './define';
import {
    COLUMN_TEMPLATES,
    type ElementDefinition,
    elementDefinition,
    type StructurePreset,
} from './elements';
import { defaultValue, type Field, type FieldValue, toAnchor } from './fields';
import { type Device, DEVICES, type NodeStyle, readNodeStyle } from './node-style';
import { newId, type ReadOptions, readSettings, UID } from './read-settings';
import { cleanText, isRecord } from './text';

/**
 * A page's element tree (roadmap phase 56): a free section holds nodes; a container node holds
 * elements and other containers. Reading never fails, like the rest of a layout: an unknown
 * element is dropped, older props are migrated, wrong values take their defaults.
 */

export const NODE_LIMITS = {
    /** Containers inside containers: more than this can't be saved. */
    depth: 3,
    /** Nodes on one page: more than this can't be saved. */
    nodes: 400,
} as const;

/** Reading stops here, whatever was stored, so a damaged page can't grow without end. */
const HARD_DEPTH = 6;
const HARD_NODES = 1000;

/** What an element's props hold: any field's value (text in two languages, an image, a link, a number…). */
export type NodeProps = Record<string, FieldValue<Field>>;

/** One node of the tree, as stored. Like sections, nodes have a `uid`, never an `id`. */
export interface NodeData {
    uid: string;
    type: string;
    /** The element definition's version this was written for. */
    v: number;
    /** Hidden nodes stay in the tree but don't show. */
    hidden: boolean;
    /** The merchant's own name for it, shown only in the editor. */
    label: string;
    props: NodeProps;
    style: NodeStyle;
    /** For buttons that jump here (`#sizes`). Left out when there is none. */
    anchor?: string;
    /** The merchant's own CSS class names, for their theme's custom CSS. Left out when empty. */
    cssClass?: string;
    /** The screen sizes it doesn't show on. Left out when it shows everywhere. */
    hideOn?: Device[];
    /** How it comes into view as the shopper scrolls to it. Left out for no animation. */
    animate?: NodeAnimation;
    /** The saved style it uses (phase 62): the theme's style with this key, under its own choices. */
    styleRef?: string;
    /** A container's contents, in order. */
    children?: NodeData[];
    /** A live block's ready-made section (its type, settings and blocks). */
    section?: SectionData;
}

/** Reads the section inside a live block (document.ts passes its own reader). */
export type ReadEmbedded = (raw: unknown) => SectionData | null;

interface ReadState {
    options: ReadOptions;
    embedded: ReadEmbedded;
    count: number;
}

/** Runs an element's migrations from the stored version up to the current one. */
export function migrateProps(definition: ElementDefinition, props: Record<string, unknown>, from: number) {
    let migrated = props;
    for (let version = from; version < definition.version; version++) {
        const migration = definition.migrations?.[version];
        if (migration) migrated = migration(migrated);
    }
    return migrated;
}

/**
 * Entrance animations (phase 58): short, subtle, CSS only (the storefront's stylesheet), and off
 * for shoppers who ask their device for reduced motion. Nothing starts hidden waiting for a script.
 */
export const NODE_ANIMATIONS = ['fade', 'rise', 'zoom'] as const;
export type NodeAnimation = (typeof NODE_ANIMATIONS)[number];

const CLASS = /^[a-zA-Z][\w-]{0,39}$/;

/** Up to five plain class names, as typed with spaces between; anything else is dropped. */
export function readClasses(value: unknown): string {
    if (typeof value !== 'string') return '';
    return [...new Set(value.split(/\s+/).filter(name => CLASS.test(name)))].slice(0, 5).join(' ');
}

function readNode(raw: unknown, state: ReadState, depth: number): NodeData | null {
    if (!isRecord(raw) || typeof raw.type !== 'string') return null;
    const definition = elementDefinition(raw.type);
    if (!definition || state.count >= HARD_NODES) return null;
    const isContainer = definition.type === 'container';
    if (isContainer && depth > HARD_DEPTH) return null;
    state.count++;
    const stored = typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v >= 1 ? raw.v : 1;
    const props = migrateProps(definition, isRecord(raw.props) ? raw.props : {}, stored);
    const node: NodeData = {
        uid: typeof raw.uid === 'string' && UID.test(raw.uid) ? raw.uid : newId(),
        type: definition.type,
        v: Math.max(stored, definition.version),
        hidden: raw.hidden === true,
        label: typeof raw.label === 'string' ? cleanText(raw.label).slice(0, 60) : '',
        props: readSettings(definition.fields, props, state.options) as NodeProps,
        style: readNodeStyle(raw.style),
    };
    const anchor = typeof raw.anchor === 'string' ? toAnchor(raw.anchor) : '';
    if (anchor) node.anchor = anchor;
    const cssClass = readClasses(raw.cssClass);
    if (cssClass) node.cssClass = cssClass;
    const hideOn = DEVICES.filter(device => Array.isArray(raw.hideOn) && raw.hideOn.includes(device));
    if (hideOn.length) node.hideOn = hideOn;
    const animate = NODE_ANIMATIONS.find(name => name === raw.animate);
    if (animate) node.animate = animate;
    if (typeof raw.styleRef === 'string' && /^[a-z0-9]{6,12}$/.test(raw.styleRef))
        node.styleRef = raw.styleRef;
    if (isContainer) {
        node.children = (Array.isArray(raw.children) ? raw.children : [])
            .map(child => readNode(child, state, depth + 1))
            .filter((child): child is NodeData => child !== null);
    }
    if (definition.type === 'live') {
        const section = state.embedded(raw.section);
        // A live block without its section has nothing to show.
        if (!section) return null;
        node.section = section;
    }
    return node;
}

/** A stored list of nodes, read for this release. */
export function readNodes(raw: unknown, options: ReadOptions, embedded: ReadEmbedded): NodeData[] {
    const state: ReadState = { options, embedded, count: 0 };
    return (Array.isArray(raw) ? raw : [])
        .map(item => readNode(item, state, 1))
        .filter((node): node is NodeData => node !== null);
}

export interface NodeVisit {
    node: NodeData;
    /** The container holding it; null at the top of a section. */
    parent: NodeData | null;
    /** How many containers deep a container is (1 at the top); an element has its parent's depth. */
    depth: number;
}

/** Every node of a tree, parents before their children. */
export function* eachNode(
    nodes: readonly NodeData[],
    parent: NodeData | null = null,
    depth = 0,
): Generator<NodeVisit> {
    for (const node of nodes) {
        const own = node.type === 'container' ? depth + 1 : depth;
        yield { node, parent, depth: own };
        if (node.children) yield* eachNode(node.children, node, own);
    }
}

export function nodeCount(nodes: readonly NodeData[]): number {
    let count = 0;
    for (const visit of eachNode(nodes)) if (visit) count++;
    return count;
}

/** The deepest container's depth (0 for no containers). */
export function nodeDepth(nodes: readonly NodeData[]): number {
    let deepest = 0;
    for (const { node, depth } of eachNode(nodes)) {
        if (node.type === 'container') deepest = Math.max(deepest, depth);
    }
    return deepest;
}

export function findNode(nodes: readonly NodeData[], uid: string): NodeVisit | null {
    for (const visit of eachNode(nodes)) if (visit.node.uid === uid) return visit;
    return null;
}

/** True when a node shows something: an element, or a container with one somewhere inside. */
export function nodeShows(node: NodeData): boolean {
    if (node.hidden) return false;
    if (node.type !== 'container') return true;
    return (node.children ?? []).some(nodeShows);
}

/** Nodes that show, hidden ones and empty containers left out (what the storefront draws). */
export function visibleNodes(nodes: readonly NodeData[]): NodeData[] {
    return nodes.filter(nodeShows);
}

/** A new node of a type, with its preset (or its fields' defaults). */
export function createNode(type: string, props: Record<string, unknown> = {}): NodeData {
    const definition = elementDefinition(type);
    if (!definition) throw new Error(`Unknown element type: ${type}`);
    const defaults = Object.fromEntries(
        Object.entries(definition.fields).map(([name, field]) => [name, defaultValue(field)]),
    );
    const node: NodeData = {
        uid: newId(),
        type,
        v: definition.version,
        hidden: false,
        label: '',
        props: readSettings(
            definition.fields,
            { ...defaults, ...definition.preset, ...props },
            {},
        ) as NodeProps,
        style: { base: {} },
    };
    if (type === 'container') node.children = [];
    return node;
}

/** A container laid out as a structure preset, with an empty container for each column. */
export function createStructure(preset: StructurePreset): NodeData {
    const outer = createNode(
        'container',
        preset.mode === 'grid'
            ? { mode: 'grid', columns: preset.columns, gap: 24 }
            : { mode: 'flex', direction: preset.direction, gap: preset.cells ? 24 : 16 },
    );
    outer.children = Array.from({ length: preset.cells }, () => createNode('container'));
    return outer;
}

/** How many columns a grid container has. */
export function columnCount(node: NodeData): number {
    const template = COLUMN_TEMPLATES[node.props.columns as keyof typeof COLUMN_TEMPLATES];
    return node.props.mode === 'grid' && template ? template.length : 1;
}

/** A copy with new IDs all the way down (duplicate, paste, insert a saved one). */
export function copyNode(node: NodeData): NodeData {
    const copy: NodeData = { ...structuredClone(node), uid: newId() };
    if (copy.children) copy.children = node.children!.map(copyNode);
    if (copy.section) {
        copy.section = {
            ...copy.section,
            uid: newId(),
            blocks: copy.section.blocks.map(block => ({ ...block, uid: newId() })),
        };
    }
    return copy;
}

/** A few words of a node's own text, for its row in the editor's tree. */
export function nodeSnippet(node: NodeData, language: 'bn' | 'en'): string {
    const name = elementDefinition(node.type)?.titleField;
    const value: unknown = name ? node.props[name] : undefined;
    if (!isRecord(value)) return '';
    const text = String((language === 'bn' ? value.bn || value.en : value.en || value.bn) ?? '');
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
}

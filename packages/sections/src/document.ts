import type { BlockData, LayoutDocument, RawSectionData, SectionData, SectionDefinition } from './define';
import { elementDefinition } from './elements';
import {
    defaultValue,
    type Field,
    type FieldIssueCode,
    fieldShown,
    type Fields,
    type ImageValue,
    type LinkValue,
    valueIssue,
} from './fields';
import { copyNode, eachNode, NODE_LIMITS, type NodeData, type NodeProps, readNodes } from './nodes';
import { newId, type ReadOptions, readSettings, UID } from './read-settings';
import { sectionDefinition } from './registry';
import { upgradeCustomV1 } from './sections/custom';
import { readStyle } from './style';
import { isRecord } from './text';

export { newId, type ReadOptions } from './read-settings';

/**
 * Layout documents (roadmap phase 15): reading stored data whatever its age, checking it before
 * publishing, and finding what it refers to.
 *
 * Reading never fails: an unknown section type is dropped, older data is migrated to the current
 * version, unknown fields are ignored and missing or damaged values take their defaults. So old
 * drafts always open after an upgrade.
 *
 * Since phase 56 a free section holds a tree of nodes (nodes.ts), and a node can be a live block
 * holding a ready-made section. Everything here that walks a document walks those too.
 */

export const LAYOUT_LIMITS = {
    /** More sections than this can't be published. */
    sections: 40,
    /** Above this the editor warns that the page may get slow. */
    warnAbove: 25,
} as const;

function rawData(raw: Record<string, unknown>): RawSectionData {
    return {
        settings: isRecord(raw.settings) ? raw.settings : {},
        blocks: Array.isArray(raw.blocks)
            ? raw.blocks.filter(isRecord).map(block => ({
                  uid: typeof block.uid === 'string' ? block.uid : '',
                  settings: isRecord(block.settings) ? block.settings : {},
              }))
            : [],
        children: raw.children,
    };
}

/** Runs the definition's migrations from the stored version up to the current one. */
export function migrateSection(
    definition: SectionDefinition,
    data: RawSectionData,
    from: number,
): RawSectionData {
    let migrated = data;
    for (let version = from; version < definition.version; version++) {
        const migration = definition.migrations?.[version];
        if (migration) migrated = migration(migrated);
    }
    return migrated;
}

/** One stored section, read for the current version; null for a type this release doesn't know. */
export function readSection(raw: unknown, options: ReadOptions = {}): SectionData | null {
    if (!isRecord(raw) || typeof raw.type !== 'string') return null;
    const definition = sectionDefinition(raw.type);
    if (!definition) return null;
    const stored = typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v >= 1 ? raw.v : 1;
    const uid = typeof raw.uid === 'string' && UID.test(raw.uid) ? raw.uid : newId();
    const data = migrateSection(definition, rawData(raw), stored);
    const blocks: BlockData[] = definition.blocks
        ? data.blocks.slice(0, definition.blocks.max).map(block => ({
              uid: UID.test(block.uid) ? block.uid : newId(),
              settings: readSettings(
                  definition.blocks!.fields,
                  block.settings,
                  options,
              ) as BlockData['settings'],
          }))
        : [];
    const section: SectionData = {
        uid,
        type: definition.type,
        v: Math.max(stored, definition.version),
        hidden: raw.hidden === true,
        settings: readSettings(definition.fields, data.settings, options) as SectionData['settings'],
        blocks,
        style: readStyle(raw.style, definition.style),
    };
    if (definition.tree) {
        // The Custom section of phase 16 kept columns of blocks: they become a grid container.
        const children =
            definition.type === 'custom' && stored < 2 ? upgradeCustomV1(data, uid) : data.children;
        // A live block holds a ready-made section, never another free one.
        section.children = readNodes(children, options, embedded => {
            const inner = readSection(embedded, options);
            return inner && !sectionDefinition(inner.type)?.tree ? inner : null;
        });
    }
    return section;
}

/** A stored layout, read for this release (see the file's comment). IDs are made unique. */
export function readDocument(raw: unknown, options: ReadOptions = {}): LayoutDocument {
    const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.sections) ? raw.sections : [];
    const seen = new Set<string>();
    const unique = (item: { uid: string }, ids = seen) => {
        if (ids.has(item.uid)) item.uid = newId();
        ids.add(item.uid);
    };
    const uniqueBlocks = (section: SectionData) => {
        const blockIds = new Set<string>();
        for (const block of section.blocks) unique(block, blockIds);
    };
    const sections: SectionData[] = [];
    for (const item of list) {
        const section = readSection(item, options);
        if (!section) continue;
        unique(section);
        uniqueBlocks(section);
        // Nodes are found by their ID alone (the stylesheet, the editor), so no two on a page share one.
        for (const { node } of eachNode(section.children ?? [])) {
            unique(node);
            if (node.section) {
                unique(node.section);
                uniqueBlocks(node.section);
            }
        }
        sections.push(section);
    }
    return { sections };
}

/** A new section with its preset (or its fields' defaults). */
export function createSection(type: string): SectionData {
    const definition = sectionDefinition(type);
    if (!definition) throw new Error(`Unknown section type: ${type}`);
    const blocks = (definition.preset?.blocks ?? (definition.blocks?.min ? [{}] : [])).map(settings => ({
        uid: newId(),
        settings,
    }));
    return readSection({
        uid: newId(),
        type,
        v: definition.version,
        settings: definition.preset?.settings ?? {},
        blocks,
        children: definition.preset?.children?.(),
    })!;
}

/** A copy with new IDs (duplicate a section, or insert a saved one). */
export function copySection(section: SectionData): SectionData {
    const copy: SectionData = {
        ...structuredClone(section),
        uid: newId(),
        blocks: section.blocks.map(block => ({ uid: newId(), settings: structuredClone(block.settings) })),
    };
    if (section.children) copy.children = section.children.map(copyNode);
    return copy;
}

/** A new block for a section, with its fields' defaults. */
export function createBlock(type: string): BlockData {
    const fields = sectionDefinition(type)?.blocks?.fields ?? {};
    return {
        uid: newId(),
        settings: Object.fromEntries(
            Object.entries(fields).map(([name, definition]) => [name, defaultValue(definition)]),
        ) as BlockData['settings'],
    };
}

/** One set of field values somewhere in a section: its settings, a block's, a node's props. */
interface Part {
    /** The section on the page. */
    top: SectionData;
    /** The section the fields belong to: `top`, or the ready-made section inside a live block. */
    owner: SectionData;
    block?: BlockData;
    /** The node whose props these are, or the live block holding `owner`. */
    node?: NodeData;
    fields: Fields;
    settings: Record<string, unknown>;
}

type PartMap = (part: Part) => Record<string, unknown>;

function mapNodeParts(nodes: readonly NodeData[], map: PartMap, top: SectionData): NodeData[] {
    return nodes.map(node => {
        const fields = elementDefinition(node.type)?.fields ?? {};
        const props = map({ top, owner: top, node, fields, settings: node.props }) as NodeProps;
        const next: NodeData = { ...node, props };
        if (node.children) next.children = mapNodeParts(node.children, map, top);
        if (node.section) next.section = mapSectionParts(node.section, map, top, node);
        return next;
    });
}

/** A section with every set of field values in it replaced by `map`'s result. */
function mapSectionParts(
    section: SectionData,
    map: PartMap,
    top: SectionData = section,
    node?: NodeData,
): SectionData {
    const definition = sectionDefinition(section.type)!;
    const next: SectionData = {
        ...section,
        settings: map({
            top,
            owner: section,
            node,
            fields: definition.fields,
            settings: section.settings,
        }) as SectionData['settings'],
        blocks: section.blocks.map(block => ({
            ...block,
            settings: map({
                top,
                owner: section,
                block,
                node,
                fields: definition.blocks?.fields ?? {},
                settings: block.settings,
            }) as BlockData['settings'],
        })),
    };
    if (section.children) next.children = mapNodeParts(section.children, map, top);
    return next;
}

/** A tree without its hidden nodes. */
function shownNodes(nodes: readonly NodeData[]): NodeData[] {
    return nodes
        .filter(node => !node.hidden)
        .map(node => (node.children ? { ...node, children: shownNodes(node.children) } : node));
}

/** A document without what's hidden: sections, and nodes inside free sections. */
function shownOnly(document: LayoutDocument): LayoutDocument {
    return {
        sections: document.sections
            .filter(section => !section.hidden)
            .map(section =>
                section.children ? { ...section, children: shownNodes(section.children) } : section,
            ),
    };
}

export interface SmartSection {
    /** A ready-made section: one on the page, or one inside a live block. */
    section: SectionData;
    /** The section on the page it's in (itself, when it's on the page). */
    top: SectionData;
    /** The live block holding it, when it's inside a free section. */
    node?: NodeData;
}

/** Every ready-made section of a document, those inside live blocks included (hidden ones too). */
export function smartSections(document: LayoutDocument): SmartSection[] {
    const found: SmartSection[] = [];
    for (const top of document.sections) {
        if (!top.children) {
            found.push({ section: top, top });
            continue;
        }
        for (const { node } of eachNode(top.children)) {
            if (node.section) found.push({ section: node.section, top, node });
        }
    }
    return found;
}

/** The ready-made sections that show (the storefront loads their products and categories). */
export function shownSmartSections(document: LayoutDocument): SectionData[] {
    return smartSections(shownOnly(document)).map(item => item.section);
}

export interface FieldVisit {
    /** The section on the page. */
    section: SectionData;
    /** The section the field belongs to: `section`, or the ready-made one inside a live block. */
    owner: SectionData;
    block?: BlockData;
    /** The node the field belongs to, or the live block holding `owner`. */
    node?: NodeData;
    name: string;
    field: Field;
    value: unknown;
    /** Whether the field shows for the current settings (`when`). */
    shown: boolean;
}

/** Every field value in a document: sections, blocks, nodes and the sections inside live blocks. */
export function* eachField(document: LayoutDocument): Generator<FieldVisit> {
    for (const section of document.sections) {
        if (!sectionDefinition(section.type)) continue;
        const visits: FieldVisit[] = [];
        mapSectionParts(section, part => {
            for (const [name, field] of Object.entries(part.fields)) {
                visits.push({
                    section: part.top,
                    owner: part.owner,
                    block: part.block,
                    node: part.node,
                    name,
                    field,
                    value: part.settings[name],
                    shown: fieldShown(field, part.settings),
                });
            }
            return part.settings;
        });
        yield* visits;
    }
}

export type LayoutIssueCode =
    | FieldIssueCode
    | 'duplicateAnchor'
    | 'tooManySections'
    | 'duplicateOrderForm'
    | 'tooDeep'
    | 'tooManyNodes';

export interface LayoutIssue {
    sectionId: string;
    /** A block's ID, or a node's inside a free section. */
    blockId?: string;
    /** The field's name, or `style.anchor`, or `sections`. */
    field: string;
    code: LayoutIssueCode;
}

/**
 * What stops a layout from being published: broken links and videos, repeated anchors, too many
 * sections, containers nested too deep and too many elements.
 */
export function documentIssues(document: LayoutDocument): LayoutIssue[] {
    const issues: LayoutIssue[] = [];
    for (const visit of eachField(document)) {
        if (!visit.shown) continue;
        const code = valueIssue(visit.field, visit.value);
        if (code) {
            issues.push({
                sectionId: visit.section.uid,
                blockId: visit.node?.uid ?? visit.block?.uid,
                field: visit.name,
                code,
            });
        }
    }
    const anchors = new Set<string>();
    for (const section of document.sections) {
        if (!section.style.anchor) continue;
        if (anchors.has(section.style.anchor)) {
            issues.push({ sectionId: section.uid, field: 'style.anchor', code: 'duplicateAnchor' });
        }
        anchors.add(section.style.anchor);
    }
    // A sales page takes orders through one form.
    const forms = smartSections(document).filter(item => item.section.type === 'order-form');
    for (const extra of forms.slice(1)) {
        issues.push({
            sectionId: extra.top.uid,
            blockId: extra.node?.uid,
            field: 'sections',
            code: 'duplicateOrderForm',
        });
    }
    if (document.sections.length > LAYOUT_LIMITS.sections) {
        issues.push({
            sectionId: document.sections[LAYOUT_LIMITS.sections]!.uid,
            field: 'sections',
            code: 'tooManySections',
        });
    }
    let nodes = 0;
    let tooMany = false;
    for (const section of document.sections) {
        let tooDeep = false;
        for (const { node, depth } of eachNode(section.children ?? [])) {
            nodes++;
            if (!tooDeep && node.type === 'container' && depth > NODE_LIMITS.depth) {
                tooDeep = true;
                issues.push({
                    sectionId: section.uid,
                    blockId: node.uid,
                    field: 'sections',
                    code: 'tooDeep',
                });
            }
            if (!tooMany && nodes > NODE_LIMITS.nodes) {
                tooMany = true;
                issues.push({ sectionId: section.uid, field: 'sections', code: 'tooManyNodes' });
            }
        }
    }
    return issues;
}

export type RefKind = 'product' | 'collection' | 'page' | 'asset';

/** Calls `visit` for every ID a document refers to; returns the document with `visit`'s replacements. */
export function mapDocumentIds(
    document: LayoutDocument,
    visit: (kind: RefKind, id: string, section: SectionData) => string,
): LayoutDocument {
    const image = (value: ImageValue | null, section: SectionData) =>
        value ? { ...value, assetId: visit('asset', value.assetId, section) } : value;
    const link = (value: LinkValue, section: SectionData): LinkValue => {
        if (value.type === 'category') return { ...value, ref: visit('collection', value.ref, section) };
        if (value.type === 'product' || value.type === 'page') {
            return { ...value, ref: visit(value.type, value.ref, section) };
        }
        return value;
    };
    const mapSettings = ({ fields, settings, top }: Part) => {
        const mapped: Record<string, unknown> = { ...settings };
        for (const [name, field] of Object.entries(fields)) {
            const value = settings[name];
            switch (field.kind) {
                case 'image':
                    mapped[name] = image(value as ImageValue | null, top);
                    break;
                case 'product':
                case 'collection':
                    mapped[name] = value === null ? null : visit(field.kind, value as string, top);
                    break;
                case 'productList':
                    mapped[name] = (value as string[]).map(id => visit('product', id, top));
                    break;
                case 'collectionList':
                    mapped[name] = (value as string[]).map(id => visit('collection', id, top));
                    break;
                case 'link':
                    mapped[name] = link(value as LinkValue, top);
                    break;
            }
        }
        return mapped;
    };
    return {
        sections: document.sections.map(section => {
            const mapped = mapSectionParts(section, mapSettings);
            return {
                ...mapped,
                style: { ...section.style, backgroundImage: image(section.style.backgroundImage, section) },
            };
        }),
    };
}

export interface DocumentRefs {
    products: string[];
    collections: string[];
    pages: string[];
    assets: string[];
}

/** The products, categories, pages and images a document refers to (only what shows, by default). */
export function documentRefs(document: LayoutDocument, { includeHidden = false } = {}): DocumentRefs {
    const sets = {
        product: new Set<string>(),
        collection: new Set<string>(),
        page: new Set<string>(),
        asset: new Set<string>(),
    };
    mapDocumentIds(includeHidden ? document : shownOnly(document), (kind, id) => {
        sets[kind].add(id);
        return id;
    });
    return {
        products: [...sets.product],
        collections: [...sets.collection],
        pages: [...sets.page],
        assets: [...sets.asset],
    };
}

/** Every link in a document replaced by `map`'s result (the core adds `href`). */
export function mapLinks(document: LayoutDocument, map: (link: LinkValue) => LinkValue): LayoutDocument {
    const mapSettings = ({ fields, settings }: Part) =>
        Object.fromEntries(
            Object.entries(settings).map(([name, value]) => [
                name,
                fields[name]?.kind === 'link' ? map(value as LinkValue) : value,
            ]),
        );
    return { sections: document.sections.map(section => mapSectionParts(section, mapSettings)) };
}

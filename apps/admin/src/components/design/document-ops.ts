import {
    type Bilingual,
    copyNode,
    copySection,
    createBlock,
    type Device,
    eachNode,
    elementDefinition,
    findNode,
    LAYOUT_LIMITS,
    type LayoutDocument,
    NODE_LIMITS,
    type NodeData,
    nodeCount,
    nodeDepth,
    type NodeProps,
    nodeSnippet,
    type NodeStyleProp,
    openSection,
    pick,
    type SectionData,
    sectionDefinition,
    type SectionStyle,
    withStyleValue,
} from '@ecommbd/sections';

/**
 * Changes to a layout document in the editor (roadmap phase 15). Every function returns a new
 * document and leaves the old one as it was, so undo keeps whole snapshots.
 */

function mapSection(document: LayoutDocument, uid: string, change: (section: SectionData) => SectionData) {
    return { sections: document.sections.map(section => (section.uid === uid ? change(section) : section)) };
}

type Settings = SectionData['settings'];

/** A section with one setting changed (a section on the page, or the one inside a live block). */
export function withSetting(section: SectionData, name: string, value: unknown): SectionData {
    return { ...section, settings: { ...section.settings, [name]: value } as Settings };
}

export function withBlockSetting(
    section: SectionData,
    blockUid: string,
    name: string,
    value: unknown,
): SectionData {
    return {
        ...section,
        blocks: section.blocks.map(block =>
            block.uid === blockUid
                ? { ...block, settings: { ...block.settings, [name]: value } as Settings }
                : block,
        ),
    };
}

export function setSetting(
    document: LayoutDocument,
    uid: string,
    name: string,
    value: unknown,
): LayoutDocument {
    return mapSection(document, uid, section => withSetting(section, name, value));
}

export function setBlockSetting(
    document: LayoutDocument,
    uid: string,
    blockUid: string,
    name: string,
    value: unknown,
): LayoutDocument {
    return mapSection(document, uid, section => withBlockSetting(section, blockUid, name, value));
}

export function setStyle(
    document: LayoutDocument,
    uid: string,
    patch: Partial<SectionStyle>,
): LayoutDocument {
    return mapSection(document, uid, section => ({ ...section, style: { ...section.style, ...patch } }));
}

export function setHidden(document: LayoutDocument, uid: string, hidden: boolean): LayoutDocument {
    return mapSection(document, uid, section => ({ ...section, hidden }));
}

/** Moves the section at `from` to `to` (indexes in the current list). */
export function moveSection(document: LayoutDocument, from: number, to: number): LayoutDocument {
    const sections = [...document.sections];
    if (from < 0 || from >= sections.length || to < 0 || to >= sections.length || from === to)
        return document;
    const [moved] = sections.splice(from, 1);
    sections.splice(to, 0, moved!);
    return { sections };
}

/** Adds a section at `index` (the end by default); unchanged at 40 sections. */
export function insertSection(
    document: LayoutDocument,
    section: SectionData,
    index = document.sections.length,
) {
    if (document.sections.length >= LAYOUT_LIMITS.sections) return document;
    const sections = [...document.sections];
    sections.splice(Math.max(0, Math.min(index, sections.length)), 0, section);
    return { sections };
}

export function removeSection(document: LayoutDocument, uid: string): LayoutDocument {
    return { sections: document.sections.filter(section => section.uid !== uid) };
}

/** A copy right below the original, with new IDs. */
export function duplicateSection(
    document: LayoutDocument,
    uid: string,
): { document: LayoutDocument; copy: SectionData | null } {
    const index = document.sections.findIndex(section => section.uid === uid);
    if (index < 0 || document.sections.length >= LAYOUT_LIMITS.sections) return { document, copy: null };
    const copy = copySection(document.sections[index]!);
    return { document: insertSection(document, copy, index + 1), copy };
}

export function withBlockAdded(section: SectionData): SectionData {
    const max = sectionDefinition(section.type)?.blocks?.max ?? 0;
    if (section.blocks.length >= max) return section;
    return { ...section, blocks: [...section.blocks, createBlock(section.type)] };
}

export function withBlockRemoved(section: SectionData, blockUid: string): SectionData {
    const min = sectionDefinition(section.type)?.blocks?.min ?? 0;
    if (section.blocks.length <= min) return section;
    return { ...section, blocks: section.blocks.filter(block => block.uid !== blockUid) };
}

export function withBlockMoved(section: SectionData, from: number, to: number): SectionData {
    const blocks = [...section.blocks];
    if (to < 0 || to >= blocks.length || from === to) return section;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved!);
    return { ...section, blocks };
}

export function addBlock(document: LayoutDocument, uid: string): LayoutDocument {
    return mapSection(document, uid, withBlockAdded);
}

export function removeBlock(document: LayoutDocument, uid: string, blockUid: string): LayoutDocument {
    return mapSection(document, uid, section => withBlockRemoved(section, blockUid));
}

export function moveBlock(document: LayoutDocument, uid: string, from: number, to: number): LayoutDocument {
    return mapSection(document, uid, section => withBlockMoved(section, from, to));
}

/** Changes to a section itself (the one on the page). */
export function updateSection(
    document: LayoutDocument,
    uid: string,
    change: (section: SectionData) => SectionData,
): LayoutDocument {
    return mapSection(document, uid, change);
}

// The element tree of a free section (roadmap phase 56).

function mapTree(nodes: readonly NodeData[], change: (nodes: NodeData[]) => NodeData[]): NodeData[] {
    return change(
        nodes.map(node => (node.children ? { ...node, children: mapTree(node.children, change) } : node)),
    );
}

/** One node of a free section replaced by `change`'s result. */
export function updateNode(
    document: LayoutDocument,
    uid: string,
    nodeUid: string,
    change: (node: NodeData) => NodeData,
): LayoutDocument {
    return mapSection(document, uid, section => ({
        ...section,
        children: mapTree(section.children ?? [], nodes =>
            nodes.map(node => (node.uid === nodeUid ? change(node) : node)),
        ),
    }));
}

export function setNodeProp(
    document: LayoutDocument,
    uid: string,
    nodeUid: string,
    name: string,
    value: unknown,
): LayoutDocument {
    return updateNode(document, uid, nodeUid, node => ({
        ...node,
        props: { ...node.props, [name]: value } as NodeProps,
    }));
}

/** One style property set on one device (an empty value clears it: the wider device's shows). */
export function setNodeStyle(
    document: LayoutDocument,
    uid: string,
    nodeUid: string,
    device: Device,
    name: NodeStyleProp,
    value: unknown,
): LayoutDocument {
    return updateNode(document, uid, nodeUid, node => ({
        ...node,
        style: withStyleValue(node.style, device, name, value),
    }));
}

export function removeNode(document: LayoutDocument, uid: string, nodeUid: string): LayoutDocument {
    return mapSection(document, uid, section => ({
        ...section,
        children: mapTree(section.children ?? [], nodes => nodes.filter(node => node.uid !== nodeUid)),
    }));
}

/** Moves a node one place up or down among its siblings. */
export function moveNode(document: LayoutDocument, uid: string, nodeUid: string, by: -1 | 1): LayoutDocument {
    return mapSection(document, uid, section => ({
        ...section,
        children: mapTree(section.children ?? [], nodes => {
            const from = nodes.findIndex(node => node.uid === nodeUid);
            const to = from + by;
            if (from < 0 || to < 0 || to >= nodes.length) return nodes;
            const moved = [...nodes];
            [moved[from], moved[to]] = [moved[to]!, moved[from]!];
            return moved;
        }),
    }));
}

/** Why a node can't go somewhere: containers nested too deep, or too many nodes on the page. */
export type NodeRefusal = 'tooDeep' | 'tooManyNodes';

function pageNodes(document: LayoutDocument): number {
    return document.sections.reduce((count, section) => count + nodeCount(section.children ?? []), 0);
}

/**
 * Puts a node in a free section: inside the container `parentUid`, or at the top of the section
 * (null), at `index` (the end by default). Refused when it would break the page's limits.
 */
export function insertNode(
    document: LayoutDocument,
    uid: string,
    parentUid: string | null,
    node: NodeData,
    index?: number,
): { document: LayoutDocument; refused?: NodeRefusal } {
    const section = document.sections.find(item => item.uid === uid);
    if (!section?.children) return { document };
    const parent = parentUid ? findNode(section.children, parentUid) : null;
    if (parentUid && parent?.node.type !== 'container') return { document };
    if ((parent?.depth ?? 0) + nodeDepth([node]) > NODE_LIMITS.depth) return { document, refused: 'tooDeep' };
    if (pageNodes(document) + nodeCount([node]) > NODE_LIMITS.nodes)
        return { document, refused: 'tooManyNodes' };
    const place = (nodes: readonly NodeData[]) => {
        const next = [...nodes];
        next.splice(Math.max(0, Math.min(index ?? next.length, next.length)), 0, node);
        return next;
    };
    if (!parentUid)
        return {
            document: mapSection(document, uid, item => ({ ...item, children: place(item.children ?? []) })),
        };
    return {
        document: updateNode(document, uid, parentUid, item => ({
            ...item,
            children: place(item.children ?? []),
        })),
    };
}

/** A copy right below the original, with new IDs. */
export function duplicateNode(
    document: LayoutDocument,
    uid: string,
    nodeUid: string,
): { document: LayoutDocument; copy: NodeData | null; refused?: NodeRefusal } {
    const section = document.sections.find(item => item.uid === uid);
    const found = section?.children ? findNode(section.children, nodeUid) : null;
    if (!found) return { document, copy: null };
    const copy = copyNode(found.node);
    const siblings = found.parent?.children ?? section!.children!;
    const result = insertNode(
        document,
        uid,
        found.parent?.uid ?? null,
        copy,
        siblings.indexOf(found.node) + 1,
    );
    return { ...result, copy: result.refused ? null : copy };
}

/** A ready-made section opened up into a free section (undo puts it back). */
export function openUpSection(document: LayoutDocument, uid: string): LayoutDocument {
    return mapSection(document, uid, section => openSection(section) ?? section);
}

/** A node's name in the editor: the merchant's own label, else its element's name. */
export function nodeName(node: NodeData, ui: 'bn' | 'en'): string {
    if (node.label) return node.label;
    if (node.section) {
        const definition = sectionDefinition(node.section.type);
        if (definition) return pick(definition.name, ui);
    }
    // A container is named by how it lays things out, so a tree of them reads at a glance.
    if (node.type === 'container') {
        if (node.props.mode === 'grid') return ui === 'bn' ? 'গ্রিড' : 'Grid';
        const row = node.props.direction === 'row' || node.props.direction === 'row-reverse';
        return row ? (ui === 'bn' ? 'সারি' : 'Row') : ui === 'bn' ? 'কলাম' : 'Column';
    }
    const definition = elementDefinition(node.type);
    return definition ? pick(definition.name, ui) : node.type;
}

/** The chain of containers down to a node, for the panel's breadcrumb. */
export function nodePath(nodes: readonly NodeData[], nodeUid: string): NodeData[] {
    for (const node of nodes) {
        if (node.uid === nodeUid) return [node];
        const below = node.children ? nodePath(node.children, nodeUid) : [];
        if (below.length) return [node, ...below];
    }
    return [];
}

/** The section's name and, after it, its heading (or first block's), for the list. */
export function sectionLabel(section: SectionData, language: 'bn' | 'en'): { name: string; detail: string } {
    const definition = sectionDefinition(section.type);
    const name = definition ? pick(definition.name, language) : section.type;
    const settings = section.settings as Record<string, unknown>;
    const titleField = definition?.blocks?.titleField;
    const candidates = [
        settings.heading,
        section.blocks[0] && titleField
            ? (section.blocks[0].settings as Record<string, unknown>)[titleField]
            : undefined,
    ];
    // A free section is named by the first words in its tree.
    for (const { node } of eachNode(section.children ?? [])) {
        const snippet = nodeSnippet(node, language);
        if (snippet) return { name, detail: snippet };
    }
    const heading = candidates.find(
        (value): value is Bilingual =>
            typeof value === 'object' &&
            value !== null &&
            'bn' in value &&
            !!pick(value as Bilingual, language),
    );
    return { name, detail: heading ? pick(heading, language) : '' };
}

/** Anchors (section IDs) on the page, for buttons that jump to a section. */
export function anchorsOf(document: LayoutDocument, language: 'bn' | 'en') {
    return document.sections
        .filter(section => section.style.anchor)
        .map(section => ({ anchor: section.style.anchor, label: sectionLabel(section, language).name }));
}

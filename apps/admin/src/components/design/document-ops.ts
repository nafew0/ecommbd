import {
    type Bilingual,
    copyNode,
    isSystemLayout,
    PAGE_CONTENT,
    SYSTEM_PAGES,
    type SystemLayout,
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
    readSection,
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
    // A system page has its own part once.
    if (document.sections[index]!.type === PAGE_CONTENT) return { document, copy: null };
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

/**
 * Moves a node to another place: inside the container `parentUid` (null: the top of the section)
 * of `toUid` (its own section by default), at `index` among what is there now. Refused when it
 * would go inside itself, or would nest containers too deep.
 */
export function moveNodeTo(
    document: LayoutDocument,
    uid: string,
    nodeUid: string,
    parentUid: string | null,
    index: number,
    toUid = uid,
): { document: LayoutDocument; refused?: NodeRefusal | 'insideItself' } {
    const from = document.sections.find(item => item.uid === uid);
    const to = document.sections.find(item => item.uid === toUid);
    const found = from?.children ? findNode(from.children, nodeUid) : null;
    if (!found || !to?.children) return { document };
    const { node } = found;
    if (parentUid === nodeUid || (parentUid && findNode(node.children ?? [], parentUid))) {
        return { document, refused: 'insideItself' };
    }
    const parent = parentUid ? findNode(to.children, parentUid) : null;
    if (parentUid && parent?.node.type !== 'container') return { document };
    if ((parent?.depth ?? 0) + nodeDepth([node]) > NODE_LIMITS.depth) return { document, refused: 'tooDeep' };
    // Taking it out first shifts what comes after it in the same list down by one.
    const siblings = parent ? parent.node.children! : to.children;
    const was = uid === toUid ? siblings.indexOf(node) : -1;
    const at = was >= 0 && was < index ? index - 1 : index;
    if (was === at) return { document };
    const without = removeNode(document, uid, nodeUid);
    return { document: insertNode(without, toUid, parentUid, node, at).document };
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

let systemPage: SystemLayout | null = null;

/**
 * The system page being edited (null: an ordinary page). One editor is open at a time, and it
 * says which page it has before it draws, so the names of the page's locked block follow it.
 */
export function editingSystemPage(type: string) {
    systemPage = isSystemLayout(type) ? type : null;
}

/** The section's name and, after it, its heading (or first block's), for the list. */
export function sectionLabel(section: SectionData, language: 'bn' | 'en'): { name: string; detail: string } {
    const definition = sectionDefinition(section.type);
    // A system page's own part is named for the page it is on: "Product block", "Checkout form".
    if (section.type === PAGE_CONTENT && systemPage) {
        return { name: pick(SYSTEM_PAGES[systemPage].block, language), detail: '' };
    }
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

/** Anchors (the IDs of sections and of nodes) on the page, for buttons that jump to one. */
export function anchorsOf(document: LayoutDocument, language: 'bn' | 'en') {
    return document.sections.flatMap(section => [
        ...(section.style.anchor
            ? [{ anchor: section.style.anchor, label: sectionLabel(section, language).name }]
            : []),
        ...[...eachNode(section.children ?? [])]
            .filter(({ node }) => node.anchor)
            .map(({ node }) => ({ anchor: node.anchor!, label: nodeName(node, language) })),
    ]);
}

/** The containers a node could move into (not itself, not inside itself), each with its path as a name. */
export function moveTargets(
    section: SectionData,
    nodeUid: string,
    ui: 'bn' | 'en',
): Array<{ uid: string; label: string; count: number }> {
    const moving = findNode(section.children ?? [], nodeUid)?.node;
    const targets: Array<{ uid: string; label: string; count: number }> = [];
    for (const { node } of eachNode(section.children ?? [])) {
        if (node.type !== 'container' || node.uid === nodeUid) continue;
        if (moving && findNode(moving.children ?? [], node.uid)) continue;
        const label = nodePath(section.children ?? [], node.uid)
            .map(item => nodeName(item, ui))
            .join(' / ');
        targets.push({
            uid: node.uid,
            label,
            count: node.children!.filter(item => item.uid !== nodeUid).length,
        });
    }
    return targets;
}

/** What the editor's own clipboard holds: a node or a section, copied on any page of the store. */
export type Clip = { kind: 'node'; node: NodeData } | { kind: 'section'; section: SectionData };

const CLIP_KEY = 'ecommbd:builder-clipboard';

export function writeClip(clip: Clip): boolean {
    try {
        window.localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
        return true;
    } catch {
        return false;
    }
}

/** The copied node or section, read again for this release, with new IDs; null when there is none. */
export function readClip(): Clip | null {
    try {
        const raw = JSON.parse(window.localStorage.getItem(CLIP_KEY) ?? 'null') as Record<
            string,
            unknown
        > | null;
        if (raw?.kind === 'section') {
            const section = readSection(raw.section);
            return section ? { kind: 'section', section: copySection(section) } : null;
        }
        if (raw?.kind === 'node') {
            // Read as the only node of a free section, so it gets the same checks as a stored one.
            const holder = readSection({ type: 'custom', v: 2, children: [raw.node] });
            const node = holder?.children?.[0];
            return node ? { kind: 'node', node: copyNode(node) } : null;
        }
    } catch {
        // Nothing usable there.
    }
    return null;
}

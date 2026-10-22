import {
    type Bilingual,
    copySection,
    createBlock,
    LAYOUT_LIMITS,
    type LayoutDocument,
    pick,
    type SectionData,
    sectionDefinition,
    type SectionStyle,
} from '@ecommbd/sections';

/**
 * Changes to a layout document in the editor (roadmap phase 15). Every function returns a new
 * document and leaves the old one as it was, so undo keeps whole snapshots.
 */

function mapSection(document: LayoutDocument, uid: string, change: (section: SectionData) => SectionData) {
    return { sections: document.sections.map(section => (section.uid === uid ? change(section) : section)) };
}

type Settings = SectionData['settings'];

export function setSetting(
    document: LayoutDocument,
    uid: string,
    name: string,
    value: unknown,
): LayoutDocument {
    return mapSection(document, uid, section => ({
        ...section,
        settings: { ...section.settings, [name]: value } as Settings,
    }));
}

export function setBlockSetting(
    document: LayoutDocument,
    uid: string,
    blockUid: string,
    name: string,
    value: unknown,
): LayoutDocument {
    return mapSection(document, uid, section => ({
        ...section,
        blocks: section.blocks.map(block =>
            block.uid === blockUid
                ? { ...block, settings: { ...block.settings, [name]: value } as Settings }
                : block,
        ),
    }));
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

export function addBlock(document: LayoutDocument, uid: string): LayoutDocument {
    return mapSection(document, uid, section => {
        const max = sectionDefinition(section.type)?.blocks?.max ?? 0;
        if (section.blocks.length >= max) return section;
        return { ...section, blocks: [...section.blocks, createBlock(section.type)] };
    });
}

export function removeBlock(document: LayoutDocument, uid: string, blockUid: string): LayoutDocument {
    return mapSection(document, uid, section => {
        const min = sectionDefinition(section.type)?.blocks?.min ?? 0;
        if (section.blocks.length <= min) return section;
        return { ...section, blocks: section.blocks.filter(block => block.uid !== blockUid) };
    });
}

export function moveBlock(document: LayoutDocument, uid: string, from: number, to: number): LayoutDocument {
    return mapSection(document, uid, section => {
        const blocks = [...section.blocks];
        if (to < 0 || to >= blocks.length || from === to) return section;
        const [moved] = blocks.splice(from, 1);
        blocks.splice(to, 0, moved!);
        return { ...section, blocks };
    });
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

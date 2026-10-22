import type { BlockData, LayoutDocument, RawSectionData, SectionData, SectionDefinition } from './define';
import {
    defaultValue,
    type Field,
    type FieldIssueCode,
    fieldShown,
    type Fields,
    type ImageValue,
    type LinkValue,
    readValue,
    valueIssue,
} from './fields';
import { sectionDefinition } from './registry';
import { readStyle } from './style';
import { isRecord } from './text';

/**
 * Layout documents (roadmap phase 15): reading stored data whatever its age, checking it before
 * publishing, and finding what it refers to.
 *
 * Reading never fails: an unknown section type is dropped, older data is migrated to the current
 * version, unknown fields are ignored and missing or damaged values take their defaults. So old
 * drafts always open after an upgrade.
 */

export const LAYOUT_LIMITS = {
    /** More sections than this can't be published. */
    sections: 40,
    /** Above this the editor warns that the page may get slow. */
    warnAbove: 25,
} as const;

const ID = /^[a-z0-9]{4,24}$/;

/** A random ID for a new section or block (letters and digits). */
export function newId(): string {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => (byte % 36).toString(36)).join('');
}

/** An `href` the core resolved: a path on the store, an anchor or a web address. */
const SAFE_HREF = /^(\/(?!\/)|#|https?:\/\/)\S{0,500}$/;

function readSettings(fields: Fields, raw: Record<string, unknown>, options: ReadOptions) {
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

function rawData(raw: Record<string, unknown>): RawSectionData {
    return {
        settings: isRecord(raw.settings) ? raw.settings : {},
        blocks: Array.isArray(raw.blocks)
            ? raw.blocks.filter(isRecord).map(block => ({
                  uid: typeof block.uid === 'string' ? block.uid : '',
                  settings: isRecord(block.settings) ? block.settings : {},
              }))
            : [],
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

export interface ReadOptions {
    /** Rich text is sanitized with this (the core and storefront pass `sanitizeRichText`). */
    sanitize?: (html: string) => string;
    /**
     * Keep the `href` the core added to links (the storefront, reading what the Shop API served).
     * Stored layouts never keep one: a link's address is always worked out again from its target.
     */
    keepHrefs?: boolean;
}

/** One stored section, read for the current version; null for a type this release doesn't know. */
export function readSection(raw: unknown, options: ReadOptions = {}): SectionData | null {
    if (!isRecord(raw) || typeof raw.type !== 'string') return null;
    const definition = sectionDefinition(raw.type);
    if (!definition) return null;
    const stored = typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v >= 1 ? raw.v : 1;
    const data = migrateSection(definition, rawData(raw), stored);
    const blocks: BlockData[] = definition.blocks
        ? data.blocks.slice(0, definition.blocks.max).map(block => ({
              uid: ID.test(block.uid) ? block.uid : newId(),
              settings: readSettings(
                  definition.blocks!.fields,
                  block.settings,
                  options,
              ) as BlockData['settings'],
          }))
        : [];
    return {
        uid: typeof raw.uid === 'string' && ID.test(raw.uid) ? raw.uid : newId(),
        type: definition.type,
        v: Math.max(stored, definition.version),
        hidden: raw.hidden === true,
        settings: readSettings(definition.fields, data.settings, options) as SectionData['settings'],
        blocks,
        style: readStyle(raw.style, definition.style),
    };
}

/** A stored layout, read for this release (see the file's comment). IDs are made unique. */
export function readDocument(raw: unknown, options: ReadOptions = {}): LayoutDocument {
    const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.sections) ? raw.sections : [];
    const seen = new Set<string>();
    const sections: SectionData[] = [];
    for (const item of list) {
        const section = readSection(item, options);
        if (!section) continue;
        if (seen.has(section.uid)) section.uid = newId();
        seen.add(section.uid);
        const blockIds = new Set<string>();
        for (const block of section.blocks) {
            if (blockIds.has(block.uid)) block.uid = newId();
            blockIds.add(block.uid);
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
    })!;
}

/** A copy with new IDs (duplicate a section, or insert a saved one). */
export function copySection(section: SectionData): SectionData {
    return {
        ...structuredClone(section),
        uid: newId(),
        blocks: section.blocks.map(block => ({ uid: newId(), settings: structuredClone(block.settings) })),
    };
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

export interface FieldVisit {
    section: SectionData;
    block?: BlockData;
    name: string;
    field: Field;
    value: unknown;
    /** Whether the field shows for the current settings (`when`). */
    shown: boolean;
}

/** Every field value in a document, sections and blocks. */
export function* eachField(document: LayoutDocument): Generator<FieldVisit> {
    for (const section of document.sections) {
        const definition = sectionDefinition(section.type);
        if (!definition) continue;
        const settings = section.settings as Record<string, unknown>;
        for (const [name, field] of Object.entries(definition.fields)) {
            yield { section, name, field, value: settings[name], shown: fieldShown(field, settings) };
        }
        for (const block of section.blocks) {
            const blockSettings = block.settings as Record<string, unknown>;
            for (const [name, field] of Object.entries(definition.blocks?.fields ?? {})) {
                yield {
                    section,
                    block,
                    name,
                    field,
                    value: blockSettings[name],
                    shown: fieldShown(field, blockSettings),
                };
            }
        }
    }
}

export type LayoutIssueCode = FieldIssueCode | 'duplicateAnchor' | 'tooManySections' | 'duplicateOrderForm';

export interface LayoutIssue {
    sectionId: string;
    blockId?: string;
    /** The field's name, or `style.anchor`, or `sections`. */
    field: string;
    code: LayoutIssueCode;
}

/** What stops a layout from being published: broken links and videos, repeated anchors, too many sections. */
export function documentIssues(document: LayoutDocument): LayoutIssue[] {
    const issues: LayoutIssue[] = [];
    for (const visit of eachField(document)) {
        if (!visit.shown) continue;
        const code = valueIssue(visit.field, visit.value);
        if (code) {
            issues.push({ sectionId: visit.section.uid, blockId: visit.block?.uid, field: visit.name, code });
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
    const forms = document.sections.filter(section => section.type === 'order-form');
    for (const extra of forms.slice(1)) {
        issues.push({ sectionId: extra.uid, field: 'sections', code: 'duplicateOrderForm' });
    }
    if (document.sections.length > LAYOUT_LIMITS.sections) {
        issues.push({
            sectionId: document.sections[LAYOUT_LIMITS.sections]!.uid,
            field: 'sections',
            code: 'tooManySections',
        });
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
    const mapSettings = (fields: Fields, settings: Record<string, unknown>, section: SectionData) => {
        const mapped: Record<string, unknown> = { ...settings };
        for (const [name, field] of Object.entries(fields)) {
            const value = settings[name];
            switch (field.kind) {
                case 'image':
                    mapped[name] = image(value as ImageValue | null, section);
                    break;
                case 'product':
                case 'collection':
                    mapped[name] = value === null ? null : visit(field.kind, value as string, section);
                    break;
                case 'productList':
                    mapped[name] = (value as string[]).map(id => visit('product', id, section));
                    break;
                case 'collectionList':
                    mapped[name] = (value as string[]).map(id => visit('collection', id, section));
                    break;
                case 'link':
                    mapped[name] = link(value as LinkValue, section);
                    break;
            }
        }
        return mapped;
    };
    return {
        sections: document.sections.map(section => {
            const definition = sectionDefinition(section.type)!;
            return {
                ...section,
                settings: mapSettings(
                    definition.fields,
                    section.settings,
                    section,
                ) as SectionData['settings'],
                blocks: section.blocks.map(block => ({
                    ...block,
                    settings: mapSettings(
                        definition.blocks?.fields ?? {},
                        block.settings,
                        section,
                    ) as BlockData['settings'],
                })),
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

/** The products, categories, pages and images a document refers to (only shown sections by default). */
export function documentRefs(document: LayoutDocument, { includeHidden = false } = {}): DocumentRefs {
    const sets = {
        product: new Set<string>(),
        collection: new Set<string>(),
        page: new Set<string>(),
        asset: new Set<string>(),
    };
    const shown = includeHidden
        ? document
        : { sections: document.sections.filter(section => !section.hidden) };
    mapDocumentIds(shown, (kind, id) => {
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
    const mapSettings = (fields: Fields, settings: Record<string, unknown>) =>
        Object.fromEntries(
            Object.entries(settings).map(([name, value]) => [
                name,
                fields[name]?.kind === 'link' ? map(value as LinkValue) : value,
            ]),
        );
    return {
        sections: document.sections.map(section => {
            const definition = sectionDefinition(section.type)!;
            return {
                ...section,
                settings: mapSettings(definition.fields, section.settings) as SectionData['settings'],
                blocks: section.blocks.map(block => ({
                    ...block,
                    settings: mapSettings(
                        definition.blocks?.fields ?? {},
                        block.settings,
                    ) as BlockData['settings'],
                })),
            };
        }),
    };
}

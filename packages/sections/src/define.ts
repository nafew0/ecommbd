import type { Fields, Values } from './fields';
import type { NodeData } from './nodes';
import type { SectionStyle } from './style';
import type { Bilingual } from './text';

/**
 * The pages that have layouts. `landing` arrives with sales pages (phase 16); the store's header
 * and footer and its listing, cart, checkout and thank-you pages with phase 60.
 */
export const LAYOUT_TYPES = [
    'home',
    'page',
    'product',
    'landing',
    'header',
    'footer',
    'listing',
    'cart',
    'checkout',
    'thanks',
] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];

/**
 * System pages (phase 60): the store draws their main part itself (the product, the product list,
 * the cart, the checkout form, the receipt, the header, the footer). The merchant designs around
 * it; a locked "page content" section marks where it goes.
 */
export const SYSTEM_LAYOUTS = [
    'header',
    'footer',
    'product',
    'listing',
    'cart',
    'checkout',
    'thanks',
] as const satisfies readonly LayoutType[];
export type SystemLayout = (typeof SYSTEM_LAYOUTS)[number];

/** Groups in the editor's "Add section" library. */
export const SECTION_CATEGORIES = [
    'intro',
    'products',
    'content',
    'media',
    'trust',
    'contact',
    'layout',
] as const;
export type SectionCategory = (typeof SECTION_CATEGORIES)[number];

/** Stored settings and blocks as they were, before a migration turns them into the next version's. */
export interface RawSectionData {
    settings: Record<string, unknown>;
    blocks: Array<{ uid: string; settings: Record<string, unknown> }>;
    /** A free section's tree, as stored (not yet checked). */
    children?: unknown;
}

/** Turns version n's stored data into version n + 1's. Must accept whatever version n could store. */
export type SectionMigration = (data: RawSectionData) => RawSectionData;

export interface BlockDefinition<Fs extends Fields = Fields> {
    /** One block, e.g. "Slide", "Question". */
    label: Bilingual;
    min?: number;
    max: number;
    fields: Fs;
    /** The field whose text names a block in the editor's list. */
    titleField?: string;
}

export interface SectionDefinition<Fs extends Fields = Fields, Bs extends Fields = Fields> {
    type: string;
    /** Raised whenever the stored shape changes, with a migration from the previous version. */
    version: number;
    name: Bilingual;
    description: Bilingual;
    category: SectionCategory;
    /** The editor's icon for the section (a name the admin maps to a drawing). */
    icon: string;
    fields: Fs;
    blocks?: BlockDefinition<Bs>;
    /** This section's style defaults, on top of `DEFAULT_STYLE`. */
    style?: Partial<SectionStyle>;
    /** Where it can be added (default: every layout). */
    layouts?: readonly LayoutType[];
    /** `migrations[n]` upgrades version n's data to version n + 1. */
    migrations?: Readonly<Record<number, SectionMigration>>;
    /** A free section (phase 56): its content is a tree of containers and elements (`children`). */
    tree?: boolean;
    /** Settings and blocks a newly added section starts with (fields' defaults otherwise). */
    preset?: {
        settings?: Partial<Values<Fs>>;
        blocks?: ReadonlyArray<Partial<Values<Bs>>>;
        /** A free section's starting tree. */
        children?: () => NodeData[];
    };
}

/** Keeps a definition's literal types (field kinds, select options) for typed section data. */
export function defineSection<const Fs extends Fields, const Bs extends Fields = Record<never, never>>(
    definition: SectionDefinition<Fs, Bs>,
): SectionDefinition<Fs, Bs> {
    return definition;
}

/**
 * Layout JSON has no `id` keys: Vendure re-encodes every `id` inside JSON responses with the
 * entity ID strategy. Sections and blocks have a `uid`; references are `assetId` and `ref`.
 */
export interface BlockData<Bs extends Fields = Fields> {
    uid: string;
    settings: Values<Bs>;
}

/** One section on a page, as stored. */
export interface SectionData<Fs extends Fields = Fields, Bs extends Fields = Fields> {
    uid: string;
    type: string;
    /** The definition's version this data was written for. */
    v: number;
    /** Hidden sections stay in the layout but don't show. */
    hidden: boolean;
    settings: Values<Fs>;
    blocks: Array<BlockData<Bs>>;
    style: SectionStyle;
    /** A free section's tree of containers and elements (phase 56). */
    children?: NodeData[];
}

/** The typed data of a definition's sections. */
export type DataOf<D> = D extends SectionDefinition<infer Fs, infer Bs> ? SectionData<Fs, Bs> : never;

/** A page's layout: its sections, in order. */
export interface LayoutDocument {
    sections: SectionData[];
}

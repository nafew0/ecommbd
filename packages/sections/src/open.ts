import type { SectionData } from './define';
import type { ColumnTemplate } from './elements';
import type { ImageValue, LinkValue } from './fields';
import { copyNode, createNode, type NodeData } from './nodes';
import { newId } from './read-settings';
import { sectionDefinition } from './registry';
import { customSection } from './sections/custom';
import type { NodeStyleValues } from './node-style';
import type { Bilingual } from './text';

/**
 * Opening a ready-made section up (roadmap phase 56): it becomes a free section whose tree of
 * containers and elements the merchant can change one by one. Sections made of words, pictures
 * and buttons become plain elements. Sections that show live data or need their own script
 * (products, the order form, a slideshow, a FAQ) become one live block: it keeps working exactly
 * as before, and elements can be added around it.
 *
 * Opening up is the merchant's choice, one section at a time, and can be undone. A section that
 * is never opened is drawn exactly as it always was.
 */

type Settings = Record<string, unknown>;
type Opener = (section: SectionData) => NodeData[];

const filled = (text: unknown): text is Bilingual =>
    typeof text === 'object' && text !== null && !!((text as Bilingual).bn || (text as Bilingual).en);

const styled = (node: NodeData, base: NodeStyleValues): NodeData => ({ ...node, style: { base } });

const heading = (text: unknown, tag = 'h2') => (filled(text) ? [createNode('heading', { text, tag })] : []);

/** Plain text as a paragraph (line breaks kept), or rich text as it is. */
function paragraph(text: unknown, rich = false): NodeData[] {
    if (!filled(text)) return [];
    if (rich) return [createNode('text', { text })];
    const html = (value: string) =>
        value
            ? `<p>${value
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\n/g, '<br>')}</p>`
            : '';
    return [createNode('text', { text: { bn: html(text.bn), en: html(text.en) } })];
}

const button = (label: unknown, link: unknown, look = 'solid') =>
    filled(label) && (link as LinkValue | undefined)?.type !== 'none'
        ? [createNode('button', { label, link, look })]
        : [];

const image = (value: unknown, link?: unknown) =>
    value ? [createNode('image', { image: value as ImageValue, link: link ?? { type: 'none' } })] : [];

function box(children: NodeData[], props: Settings = {}): NodeData {
    return { ...createNode('container', props), children };
}

const column = (children: NodeData[], gap = 16) => box(children, { gap });

const row = (children: NodeData[]) =>
    children.length ? [box(children, { direction: 'row', gap: 12, wrap: true, stack: false })] : [];

function grid(columns: ColumnTemplate, children: NodeData[], props: Settings = {}) {
    return box(children, { mode: 'grid', columns, gap: 32, rowGap: 24, ...props });
}

/** A grid's column template for a number of columns (four at most). */
const columnsFor = (count: number): ColumnTemplate =>
    (['1', '1-1', '1-1-1', '1-1-1-1'] as const)[Math.min(Math.max(Math.round(count), 1), 4) - 1]!;

/** The whole section as one live block: nothing about it changes. */
function live(section: SectionData): NodeData[] {
    const node = createNode('live');
    node.section = { ...structuredClone(section), uid: newId(), hidden: false };
    return [copyNode(node)];
}

const OPENERS: Record<string, Opener> = {
    hero: section => {
        const s = section.settings as Settings;
        const words = column([
            ...(filled(s.badge) ? [createNode('badge', { label: s.badge })] : []),
            ...heading(s.heading),
            ...paragraph(s.text),
            ...row([...button(s.button, s.link), ...button(s.secondButton, s.secondLink, 'outline')]),
        ]);
        // Text on the image: the image becomes the section's background (see `openSection`).
        if (!s.image || s.layout === 'overlay') return [words];
        return [grid('1-1', [words, column(image(s.image))], { align: 'center' })];
    },
    banner: section => {
        const s = section.settings as Settings;
        const words = column([
            ...(filled(s.eyebrow) ? [createNode('heading', { text: s.eyebrow, tag: 'p' })] : []),
            ...heading(s.heading),
            ...paragraph(s.text),
            ...row(button(s.button, s.link)),
        ]);
        return s.image ? [grid('1-1', [words, column(image(s.image))], { align: 'center' })] : [words];
    },
    'image-with-text': section => {
        const s = section.settings as Settings;
        const words = column([
            ...heading(s.heading),
            ...paragraph(s.text, true),
            ...row(button(s.button, s.link)),
        ]);
        const picture = column(image(s.image));
        return [
            grid('1-1', s.imagePosition === 'right' ? [words, picture] : [picture, words], {
                align: 'center',
                // The photo stays above its text on phones.
                phoneOrder: s.imagePosition === 'right' ? 'reverse' : 'normal',
            }),
        ];
    },
    'rich-text': section => {
        const s = section.settings as Settings;
        return [
            column([...heading(s.heading), ...paragraph(s.text, true), ...row(button(s.button, s.link))]),
        ];
    },
    multicolumn: section => {
        const s = section.settings as Settings;
        const cells = section.blocks.map(block => {
            const b = block.settings as Settings;
            return column([
                createNode('icon-box', { icon: b.icon, image: b.image, heading: b.title, body: b.text }),
            ]);
        });
        return [...heading(s.heading), grid(columnsFor(Number(s.columns) || cells.length), cells)];
    },
    testimonials: section => {
        const s = section.settings as Settings;
        // Screenshots of chats are pictures in their own frame: they stay a live block.
        if (s.look === 'screenshots') return live(section);
        const cells = section.blocks.map(block => {
            const b = block.settings as Settings;
            const who = b.name as Bilingual;
            const place = b.place as Bilingual;
            const join = (name: string, from: string) => [name, from].filter(Boolean).join(', ');
            return styled(
                column([
                    createNode('stars', { rating: b.rating }),
                    createNode('quote', {
                        text: b.text,
                        author: { bn: join(who.bn, place.bn), en: join(who.en, place.en) },
                    }),
                ]),
                { padding: 20, borderWidth: 1, borderColor: '#e5e5e5' },
            );
        });
        return [...heading(s.heading), grid(columnsFor(Number(s.columns) || 3), cells, { gap: 24 })];
    },
    'trust-badges': section => {
        const s = section.settings as Settings;
        const cells = section.blocks.map(block => {
            const b = block.settings as Settings;
            return column([createNode('icon-box', { icon: b.icon, heading: b.title, body: b.text })]);
        });
        return [...heading(s.heading), grid(columnsFor(cells.length), cells)];
    },
    benefits: section => {
        const s = section.settings as Settings;
        const cells = section.blocks.map(block => {
            const b = block.settings as Settings;
            return column([createNode('icon-box', { icon: b.icon, heading: b.title, body: b.text })]);
        });
        const columns = s.look === 'grid' ? columnsFor(Number(s.columns) || 3) : '1';
        return [...heading(s.heading), grid(columns, cells)];
    },
    guarantee: section => {
        const s = section.settings as Settings;
        const picture = image(s.image).map(node => styled(node, { width: 30, textAlign: 'center' }));
        return [column([...picture, ...heading(s.heading), ...paragraph(s.text)])];
    },
    countdown: section => {
        const s = section.settings as Settings;
        // A countdown that starts when each shopper arrives needs the section's own script.
        if (s.mode !== 'fixed') return live(section);
        return [column([...heading(s.heading), createNode('countdown', { endsAt: s.endsAt })])];
    },
    divider: section => [createNode((section.settings as Settings).line ? 'divider' : 'spacer')],
};

/** True when a section becomes plain elements (not one live block) when opened up. */
export function opensToElements(type: string): boolean {
    return type in OPENERS;
}

/**
 * A ready-made section as a free section: the same place on the page, the same style options,
 * its content as a tree. Null for a free section (it's already open) or an unknown type.
 */
export function openSection(section: SectionData): SectionData | null {
    const definition = sectionDefinition(section.type);
    if (!definition || definition.tree) return null;
    const children = (OPENERS[section.type] ?? live)(section);
    const style = structuredClone(section.style);
    const settings = section.settings as Settings;
    // A hero with its text on the image keeps the image, as the section's background.
    if (section.type === 'hero' && settings.image && settings.layout === 'overlay') {
        style.background = 'image';
        style.backgroundImage = settings.image as ImageValue;
        style.align = 'center';
    }
    return {
        uid: section.uid,
        type: customSection.type,
        v: customSection.version,
        hidden: section.hidden,
        settings: {},
        blocks: [],
        style,
        children,
    };
}

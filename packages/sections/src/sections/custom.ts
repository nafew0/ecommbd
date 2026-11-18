import { defineSection, type RawSectionData } from '../define';
import { createNode, createStructure, type NodeData } from '../nodes';
import { STRUCTURE_PRESETS } from '../elements';
import { isRecord } from '../text';

/**
 * The free section (roadmap phase 56, the Custom section of phase 16 rebuilt): a tree of
 * containers and elements the merchant lays out and styles one by one. Version 1 stored columns
 * of flat elements as blocks; `upgradeCustomV1` turns those into a grid container with a
 * container per column, so pages made before the tree look the same.
 */

const label = (en: string, bn: string) => ({ bn, en });

export const customSection = defineSection({
    type: 'custom',
    version: 2,
    name: label('Free section', 'নিজের মতো সেকশন'),
    description: label(
        'Build your own: rows, columns and grids of headings, text, images, buttons, lists, video and more, each styled as you like',
        'নিজের মতো বানান: সারি, কলাম আর গ্রিডে শিরোনাম, লেখা, ছবি, বাটন, তালিকা, ভিডিও আর আরও অনেক কিছু, যেভাবে খুশি সাজিয়ে',
    ),
    category: 'layout',
    icon: 'custom',
    fields: {},
    tree: true,
    preset: {
        children: () => {
            const grid = createStructure(STRUCTURE_PRESETS.find(preset => preset.key === 'grid-2')!);
            grid.props.gap = 32;
            grid.props.rowGap = 24;
            grid.props.align = 'center';
            const [left, right] = grid.children!;
            left!.children = [createNode('image')];
            right!.children = [
                createNode('heading'),
                createNode('text', {
                    text: label(
                        '<p>Add text, buttons, lists or anything else, and style each one.</p>',
                        '<p>লেখা, বাটন, তালিকা বা অন্য যেকোনো কিছু যোগ করুন, আর প্রতিটি নিজের মতো সাজান।</p>',
                    ),
                }),
                createNode('button', {
                    label: label('Order now', 'এখনই অর্ডার করুন'),
                    link: { type: 'anchor', anchor: 'order' },
                }),
            ];
            return [grid];
        },
    },
});

/** Version 1's column layouts, by the number of columns each has. */
const V1_LAYOUTS: Record<string, number> = {
    '1': 1,
    '1-1': 2,
    '1-2': 2,
    '2-1': 2,
    '1-1-1': 3,
    '1-2-1': 3,
    '1-1-1-1': 4,
};

/** Version 1's element kinds and the element each became. */
const V1_KINDS: Record<string, string> = {
    heading: 'heading',
    text: 'text',
    image: 'image',
    button: 'button',
    list: 'icon-list',
    iconbox: 'icon-box',
    video: 'video',
    countdown: 'countdown',
    price: 'price',
    badge: 'badge',
    stars: 'stars',
    spacer: 'spacer',
    divider: 'divider',
};

/** Version 1's style settings and the style property each became. */
const V1_STYLE: Record<string, string> = {
    color: 'color',
    background: 'background',
    size: 'fontSize',
    weight: 'fontWeight',
    align: 'textAlign',
    width: 'width',
    padding: 'padding',
    radius: 'radius',
    borderWidth: 'borderWidth',
    borderColor: 'borderColor',
    spaceBelow: 'marginBottom',
};

function elementProps(kind: string, s: Record<string, unknown>): Record<string, unknown> {
    switch (kind) {
        case 'heading':
            return { text: s.heading, tag: s.tag };
        case 'text':
            return { text: s.text };
        case 'image':
            return { image: s.image, link: s.link };
        case 'button':
            return { label: s.label, link: s.link, look: s.look };
        case 'list':
            return { items: s.items, icon: s.icon };
        case 'iconbox':
            return { heading: s.heading, body: s.body, image: s.image, icon: s.icon };
        case 'video':
            return { video: s.video, title: s.heading };
        case 'countdown':
            return { endsAt: s.endsAt };
        case 'price':
            return { price: s.price, oldPrice: s.oldPrice };
        case 'badge':
            return { label: s.label };
        case 'stars':
            return { rating: s.rating };
        case 'spacer':
            return { height: s.height };
        default:
            return {};
    }
}

/** A short ID made from another, so reading the same old page twice gives the same tree. */
const derived = (uid: string, suffix: string) =>
    `${uid.replace(/[^a-z0-9]/g, '').slice(0, 20) || 'node'}${suffix}`;

/**
 * Version 1's settings and blocks as a tree, not yet checked (readNodes checks it): one grid
 * container with the old column layout, a container per column, and each block as an element in
 * its column, in the old order, with its look as the node's style.
 */
export function upgradeCustomV1(data: RawSectionData, sectionUid: string): unknown[] {
    const { settings, blocks } = data;
    if (!blocks.length) return [];
    const layout =
        typeof settings.layout === 'string' && settings.layout in V1_LAYOUTS ? settings.layout : '1-1';
    const count = V1_LAYOUTS[layout]!;
    const columns = Array.from({ length: count }, (_, index) => ({
        uid: derived(sectionUid, `c${index + 1}`),
        type: 'container',
        v: 1,
        props: { mode: 'flex', direction: 'column', gap: 16 },
        children: [] as unknown[],
    }));
    for (const block of blocks) {
        const s = block.settings;
        // An unknown kind was read as a heading in version 1.
        const kind = typeof s.kind === 'string' && s.kind in V1_KINDS ? s.kind : 'heading';
        const base: Record<string, unknown> = {};
        // A space only ever had a height.
        if (kind !== 'spacer') {
            for (const [from, to] of Object.entries(V1_STYLE)) base[to] = s[from];
        }
        const style: Record<string, unknown> = { base };
        // Version 1 never applied a size to headings, prices and badges, or a weight to headings
        // and buttons (each kept its own), so those are left out here: the page looks as it did.
        // Set again in the editor, they now apply.
        const sized = !(kind === 'price' || kind === 'badge' || (kind === 'heading' && s.tag !== 'p'));
        if (!sized) delete base.fontSize;
        if (kind === 'heading' || kind === 'button') delete base.fontWeight;
        if (sized && s.sizePhone !== undefined && s.sizePhone !== null && s.sizePhone !== '') {
            style.phone = { fontSize: s.sizePhone };
        }
        const column = Math.min(Math.max(Number(s.column) || 1, 1), count) - 1;
        columns[column]!.children.push({
            uid: block.uid,
            type: V1_KINDS[kind],
            v: 1,
            props: elementProps(kind, isRecord(s) ? s : {}),
            style,
        });
    }
    return [
        {
            uid: derived(sectionUid, 'g'),
            type: 'container',
            v: 1,
            props: {
                mode: 'grid',
                columns: layout,
                gap: settings.gap ?? 32,
                rowGap: 24,
                align: ['start', 'center', 'end'].includes(settings.verticalAlign as string)
                    ? settings.verticalAlign
                    : 'center',
                stack: true,
                phoneOrder: settings.phoneOrder === 'reverse' ? 'reverse' : 'normal',
            },
            children: columns,
        },
    ];
}

export type { NodeData };

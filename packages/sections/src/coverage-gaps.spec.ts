import { describe, expect, it } from 'vitest';
import { estimateScriptKb, pageChecklist, SCRIPT_COSTS } from './checklist';
import { layoutCss } from './css';
import type { SectionData } from './define';
import { createSection } from './document';
import { type ElementDefinition, elementDefinition } from './elements';
import { createNode, migrateProps, type NodeData } from './nodes';
import { openSection } from './open';
import { upgradeCustomV1 } from './sections/custom';

/**
 * Cases the other specs don't reach: the version 1 Custom section's rarer element kinds, element
 * migrations, the script budget blocker and a few look rules.
 */

function free(children: NodeData[]): SectionData {
    return { ...createSection('custom'), uid: 'free0001', children };
}

describe('upgrading a version 1 Custom section', () => {
    const block = (uid: string, settings: Record<string, unknown>) => ({ uid, settings });

    it('turns every old kind into its element with the same words', () => {
        const kinds = {
            text: { text: 'Words' },
            image: { image: { assetId: '1' }, link: { type: 'search' } },
            button: { label: 'Buy', link: { type: 'search' }, look: 'outline' },
            list: { items: ['One'], icon: 'check' },
            iconbox: { heading: 'Fast', body: 'Body', image: null, icon: 'truck' },
            video: { video: 'abc', heading: 'Watch' },
            countdown: { endsAt: '2026-12-01' },
            price: { price: 500, oldPrice: 700 },
            badge: { label: 'New' },
            stars: { rating: 5 },
            spacer: { height: 40, color: '#000' },
            divider: {},
            marquee: { heading: 'Read as a heading' },
        };
        const blocks = Object.entries(kinds).map(([kind, settings], index) =>
            block(`old${index}`, { kind, column: 9, ...settings }),
        );
        const [grid] = upgradeCustomV1(
            { settings: { layout: 'bogus', gap: 10, verticalAlign: 'end', phoneOrder: 'reverse' }, blocks },
            'sec-1',
        ) as Array<{
            props: Record<string, unknown>;
            children: Array<{ children: Array<Record<string, unknown>> }>;
        }>;
        expect(grid!.props).toMatchObject({ columns: '1-1', gap: 10, align: 'end', phoneOrder: 'reverse' });
        // A column past the last goes into the last one.
        const nodes = grid!.children[1]!.children;
        expect(nodes.map(node => node.type)).toEqual([
            'text',
            'image',
            'button',
            'icon-list',
            'icon-box',
            'video',
            'countdown',
            'price',
            'badge',
            'stars',
            'spacer',
            'divider',
            'heading',
        ]);
        expect(nodes[2]!.props).toEqual({ label: 'Buy', link: { type: 'search' }, look: 'outline' });
        expect(nodes[5]!.props).toEqual({ video: 'abc', title: 'Watch' });
        expect(nodes[10]!.props).toEqual({ height: 40 });
        // A space never had a look.
        expect(nodes[10]!.style).toEqual({ base: {} });
        expect(nodes[11]!.props).toEqual({});
        expect(nodes[12]!.props).toEqual({ text: 'Read as a heading', tag: undefined });
    });

    it('keeps a phone size where version 1 applied one, and nothing for an empty section', () => {
        const [grid] = upgradeCustomV1(
            { settings: {}, blocks: [block('old1', { kind: 'text', sizePhone: 14, size: 18 })] },
            'sec-2',
        ) as Array<{
            props: Record<string, unknown>;
            children: Array<{ children: Array<Record<string, unknown>> }>;
        }>;
        expect(grid!.props).toMatchObject({ gap: 32, align: 'center', phoneOrder: 'normal' });
        expect(grid!.children[0]!.children[0]!.style).toMatchObject({
            base: { fontSize: 18 },
            phone: { fontSize: 14 },
        });
        expect(upgradeCustomV1({ settings: {}, blocks: [] }, 'sec-3')).toEqual([]);
    });
});

describe('element migrations', () => {
    it('runs each step from the stored version, skipping a missing one', () => {
        const definition = {
            version: 4,
            migrations: {
                1: (props: Record<string, unknown>) => ({ ...props, one: true }),
                3: (props: Record<string, unknown>) => ({ ...props, three: true }),
            },
        } as unknown as ElementDefinition;
        expect(migrateProps(definition, { a: 1 }, 1)).toEqual({ a: 1, one: true, three: true });
        expect(migrateProps(definition, { a: 1 }, 2)).toEqual({ a: 1, three: true });
        expect(migrateProps({ version: 2 } as unknown as ElementDefinition, { a: 1 }, 1)).toEqual({ a: 1 });
    });
});

describe('the checklist, less common cases', () => {
    it('counts a sales hero video and blocks a page over its script budget', () => {
        const hero = { ...createSection('sales-hero'), uid: 'hero0001' };
        hero.settings = { ...hero.settings, media: 'video' };
        expect(estimateScriptKb({ sections: [hero] })).toBe(SCRIPT_COSTS.base + SCRIPT_COSTS.video);
        const costs = SCRIPT_COSTS as unknown as { base: number };
        const base = costs.base;
        costs.base = 100;
        try {
            expect(pageChecklist({ sections: [hero] })).toContainEqual({
                code: 'budget',
                level: 'blocker',
                sectionId: 'hero0001',
            });
        } finally {
            costs.base = base;
        }
    });

    it('warns about a video with nothing to play, and never calls words with no preset sample', () => {
        const video = createNode('video');
        const quote = createNode('quote', { text: { bn: 'নিজের কথা', en: 'Own words' } });
        // Every element has preset words today; one without them is never sample content.
        const definition = elementDefinition('quote') as unknown as { preset?: unknown };
        const preset = definition.preset;
        definition.preset = undefined;
        try {
            const codes = pageChecklist({ sections: [free([video, quote])] }).map(item => item.code);
            expect(codes).toContain('emptyText');
            expect(codes).not.toContain('sampleText');
        } finally {
            definition.preset = preset;
        }
    });
});

describe('opening a guarantee section', () => {
    it('becomes a column of its picture and words', () => {
        const section = { ...createSection('guarantee'), uid: 'guar0001' };
        section.settings = { ...section.settings, image: { assetId: '1', preview: '' } };
        const opened = openSection(section);
        expect(opened?.children?.length).toBe(1);
    });
});

describe('look rules for something narrower than its place', () => {
    const cssOf = (style: NodeData['style']) =>
        layoutCss({ sections: [free([{ ...createNode('heading'), uid: 'head0001', style }])] });

    it('pushes it to the end, or back to the start on a smaller screen', () => {
        expect(cssOf({ base: { width: 50, textAlign: 'end' } })).toContain('margin-inline:auto 0');
        expect(cssOf({ base: {}, phone: { width: 50 } })).toContain('margin-inline:0');
    });
});

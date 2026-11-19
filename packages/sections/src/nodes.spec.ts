import { describe, expect, it } from 'vitest';
import { layoutCss } from './css';
import type { SectionData } from './define';
import {
    copySection,
    createSection,
    documentIssues,
    documentRefs,
    eachField,
    mapDocumentIds,
    mapLinks,
    readDocument,
    readSection,
    shownSmartSections,
    smartSections,
} from './document';
import { ELEMENTS, elementDefinition, parseRows, STRUCTURE_PRESETS } from './elements';
import { type Device, effectiveStyle, readNodeStyle, styleCount, withStyleValue } from './node-style';
import {
    columnCount,
    copyNode,
    createNode,
    createStructure,
    eachNode,
    findNode,
    NODE_LIMITS,
    type NodeData,
    nodeCount,
    nodeDepth,
    nodeShows,
    nodeSnippet,
    readClasses,
    visibleNodes,
} from './nodes';
import { liveBlock, openSection, opensToElements } from './open';
import { SECTIONS } from './registry';
import { landingTemplate, LANDING_TEMPLATES } from './landing-templates';
import { starterLayout, STARTERS } from './starters';

const product = { name: { bn: 'খাঁটি সরিষার তেল', en: 'Pure mustard oil' } };

/** A free section holding these nodes. */
function free(children: NodeData[], uid = 'free0001'): SectionData {
    return { ...createSection('custom'), uid, children };
}

function nested(levels: number): NodeData {
    const outer = createNode('container');
    let current = outer;
    for (let level = 1; level < levels; level++) {
        const inner = createNode('container');
        current.children = [inner];
        current = inner;
    }
    current.children = [createNode('heading')];
    return outer;
}

/** A page from the Custom section of phase 16, as it was stored. */
const OLD_CUSTOM = {
    uid: 'custom01',
    type: 'custom',
    v: 1,
    settings: { layout: '1-2', gap: 40, verticalAlign: 'start', phoneOrder: 'reverse' },
    blocks: [
        { uid: 'elem0001', settings: { kind: 'image', column: '1', width: 80, align: 'center', radius: 12 } },
        {
            uid: 'elem0002',
            settings: {
                kind: 'heading',
                column: '2',
                heading: { bn: 'শিরোনাম', en: 'Heading' },
                tag: 'h3',
                color: '#aa0000',
                size: 64,
                sizePhone: 32,
                weight: '700',
            },
        },
        {
            uid: 'elem0003',
            settings: {
                kind: 'list',
                column: '2',
                items: { bn: 'এক\nদুই', en: 'One\nTwo' },
                icon: 'leaf',
                size: 20,
                sizePhone: 16,
            },
        },
        { uid: 'elem0004', settings: { kind: 'spacer', column: '9', height: 48, color: '#ffffff' } },
        {
            uid: 'elem0005',
            settings: { kind: 'marquee', column: '1', color: 'url(x)', size: 400, script: 'x' },
        },
    ],
};

describe('elements', () => {
    it('has every basic element, each named in both languages', () => {
        const types = ELEMENTS.map(definition => definition.type);
        for (const type of [
            'container',
            'heading',
            'text',
            'button',
            'image',
            'icon',
            'spacer',
            'divider',
            'list',
            'badge',
            'quote',
            'icon-box',
            'icon-list',
        ]) {
            expect(types).toContain(type);
        }
        expect(new Set(types).size).toBe(types.length);
        for (const definition of ELEMENTS) {
            expect(definition.name.bn && definition.name.en).toBeTruthy();
            expect(definition.description.bn && definition.description.en).toBeTruthy();
            for (const field of Object.values(definition.fields)) {
                expect(field.label.bn && field.label.en).toBeTruthy();
            }
        }
        // Headings go from H1 to H6.
        const tag = elementDefinition('heading')!.fields.tag!;
        expect(tag.kind === 'select' && tag.options.map(option => option.value)).toEqual([
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'p',
        ]);
    });

    it('creates each element with its preset, ready to publish', () => {
        for (const definition of ELEMENTS.filter(item => !item.internal)) {
            const node = createNode(definition.type);
            expect(documentIssues({ sections: [free([node])] })).toEqual([]);
        }
        expect(() => createNode('marquee')).toThrow();
        expect(createNode('container')).toMatchObject({
            props: { mode: 'flex', direction: 'column', gap: 16, align: 'stretch', stack: true },
            children: [],
        });
    });

    it('offers structures of one to four columns, uneven columns and a vertical stack, in grid and flex', () => {
        const shapes = STRUCTURE_PRESETS.map(preset => {
            const node = createStructure(preset);
            return [preset.key, node.props.mode, columnCount(node), node.children!.length];
        });
        expect(shapes).toEqual([
            ['grid-1', 'grid', 1, 1],
            ['grid-2', 'grid', 2, 2],
            ['grid-3', 'grid', 3, 3],
            ['grid-4', 'grid', 4, 4],
            ['grid-2-1', 'grid', 2, 2],
            ['grid-1-2', 'grid', 2, 2],
            ['flex-2', 'flex', 1, 2],
            ['flex-3', 'flex', 1, 3],
            ['flex-4', 'flex', 1, 4],
            ['flex-column', 'flex', 1, 0],
        ]);
    });
});

describe('reading a tree', () => {
    it('drops unknown elements and props, and fills missing values with defaults', () => {
        const section = readSection({
            uid: 'free0001',
            type: 'custom',
            v: 2,
            children: [
                { type: 'marquee', props: { text: 'x' } },
                'nonsense',
                {
                    uid: 'box00001',
                    type: 'container',
                    props: { mode: 'table', gap: 500, justify: 'left', script: 'x' },
                    label: '  My   box  ',
                    children: [{ uid: 'head0001', type: 'heading', props: { text: 'Hello', tag: 'h9' } }],
                },
                // A heading has no children.
                { uid: 'head0002', type: 'heading', children: [{ type: 'heading' }] },
            ],
        })!;
        expect(section.children!.map(node => node.uid)).toEqual(['box00001', 'head0002']);
        const [box, heading] = section.children!;
        expect(box).toMatchObject({ label: 'My box', hidden: false, v: 1 });
        expect(box!.props).toMatchObject({ mode: 'flex', gap: 80, justify: 'start' });
        expect(box!.props).not.toHaveProperty('script');
        expect(box!.children![0]!.props).toEqual({ text: { bn: 'Hello', en: 'Hello' }, tag: 'h2' });
        expect(heading).not.toHaveProperty('children');
        // No tree at all: an empty free section.
        expect(readSection({ type: 'custom', v: 2 })!.children).toEqual([]);
        // Ready-made sections have no tree.
        expect(readSection({ type: 'hero', children: [{ type: 'heading' }] })).not.toHaveProperty('children');
    });

    it('gives new IDs to damaged or repeated ones, across the whole page', () => {
        const heading = { uid: 'same0001', type: 'heading' };
        const document = readDocument({
            sections: [
                {
                    uid: 'same0001',
                    type: 'custom',
                    v: 2,
                    children: [heading, heading, { uid: '"]{', type: 'text' }],
                },
                { uid: 'free0002', type: 'custom', v: 2, children: [heading] },
            ],
        });
        const ids = [
            ...document.sections.map(section => section.uid),
            ...document.sections.flatMap(section => section.children!.map(node => node.uid)),
        ];
        expect(new Set(ids).size).toBe(6);
        expect(ids.every(id => /^[a-z0-9]{4,24}$/.test(id))).toBe(true);
    });

    it('reads a style for each device, keeping only checked values that are set', () => {
        const style = readNodeStyle({
            base: {
                color: '#ABC',
                background: 'url(x)',
                fontSize: 400,
                fontWeight: '950',
                position: 'fixed',
            },
            tablet: { fontSize: '' },
            phone: { fontSize: 20, textAlign: 'center' },
            watch: { fontSize: 8 },
        });
        expect(style).toEqual({
            base: { color: '#aabbcc', fontSize: 120 },
            phone: { fontSize: 20, textAlign: 'center' },
        });
        expect(readNodeStyle('nonsense')).toEqual({ base: {} });
        expect(styleCount(style, 'base')).toBe(2);
        expect(styleCount(style, 'tablet')).toBe(0);
        expect(effectiveStyle(style, 'phone')).toEqual({
            color: '#aabbcc',
            fontSize: 20,
            textAlign: 'center',
        });
        // Setting and clearing one property on one device.
        const set = withStyleValue(style, 'tablet', 'fontSize', 40);
        expect(set.tablet).toEqual({ fontSize: 40 });
        expect(effectiveStyle(set, 'tablet')).toMatchObject({ fontSize: 40, color: '#aabbcc' });
        expect(withStyleValue(set, 'tablet', 'fontSize', null)).toEqual(style);
        expect(withStyleValue(style, 'base', 'color', '').base).toEqual({ fontSize: 120 });
    });

    it('sanitizes rich text in elements and in live blocks', () => {
        const hero = createSection('image-with-text');
        hero.settings.text = { bn: '<p>ক</p>', en: '<p>a</p><script>x</script>' };
        const liveNode = { type: 'live', section: hero };
        const text = { type: 'text', props: { text: { bn: '', en: '<p>b</p><script>y</script>' } } };
        const sanitize = (html: string) => html.replace(/<script>.*<\/script>/g, '');
        const section = readSection({ type: 'custom', v: 2, children: [liveNode, text] }, { sanitize })!;
        expect(section.children![0]!.section!.settings.text).toEqual({ bn: '<p>ক</p>', en: '<p>a</p>' });
        expect(section.children![1]!.props.text).toEqual({ bn: '', en: '<p>b</p>' });
    });

    it('keeps a live block only with a ready-made section inside', () => {
        const section = readSection({
            type: 'custom',
            v: 2,
            children: [
                { type: 'live' },
                { type: 'live', section: { type: 'nonsense' } },
                { type: 'live', section: createSection('custom') },
                { uid: 'live0001', type: 'live', section: { type: 'product-grid', settings: { count: 99 } } },
            ],
        })!;
        expect(section.children!.map(node => node.uid)).toEqual(['live0001']);
        expect(section.children![0]!.section).toMatchObject({
            type: 'product-grid',
            settings: { count: 24 },
        });
    });

    it('stays the same when stored and read back', () => {
        const section = free([createStructure(STRUCTURE_PRESETS[1]), createNode('heading')]);
        section.children![1]!.style = { base: { color: '#112233' }, phone: { fontSize: 20 } };
        const document = { sections: [section, openSection(createSection('product-grid'))!] };
        expect(readDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    });
});

describe('walking a tree', () => {
    it('counts nodes and how deep containers go', () => {
        const tree = [nested(3), createNode('heading')];
        expect(nodeCount(tree)).toBe(5);
        expect(nodeDepth(tree)).toBe(3);
        expect(nodeDepth([createNode('heading')])).toBe(0);
        expect([...eachNode(tree)].map(visit => [visit.node.type, visit.depth])).toEqual([
            ['container', 1],
            ['container', 2],
            ['container', 3],
            ['heading', 3],
            ['heading', 0],
        ]);
        const inner = tree[0]!.children![0]!;
        expect(findNode(tree, inner.uid)).toMatchObject({ node: inner, parent: tree[0], depth: 2 });
        expect(findNode(tree, 'missing0')).toBeNull();
    });

    it('shows nothing for an empty or hidden container', () => {
        const empty = createStructure(STRUCTURE_PRESETS[1]);
        expect(nodeShows(empty)).toBe(false);
        const hiddenInside = createNode('container');
        hiddenInside.children = [{ ...createNode('heading'), hidden: true }];
        const filled = createNode('container');
        filled.children = [createNode('heading')];
        expect(visibleNodes([empty, hiddenInside, filled, { ...filled, hidden: true }])).toEqual([filled]);
    });

    it('copies with new IDs all the way down', () => {
        const section = free([nested(2), ...openSection(createSection('faq'))!.children!]);
        const copy = copySection(section);
        const ids = (item: SectionData) => [
            item.uid,
            ...[...eachNode(item.children!)].flatMap(({ node }) => [
                node.uid,
                ...(node.section ? [node.section.uid, ...node.section.blocks.map(block => block.uid)] : []),
            ]),
        ];
        expect(ids(copy)).toHaveLength(ids(section).length);
        expect(ids(copy).filter(id => ids(section).includes(id))).toEqual([]);
        expect(copyNode(section.children![0]!).children![0]!.children![0]!.props).toEqual(
            section.children![0]!.children![0]!.children![0]!.props,
        );
    });

    it('names a node by its own text', () => {
        const heading = createNode('heading', { text: { bn: 'শিরোনাম', en: 'A title' } });
        expect(nodeSnippet(heading, 'en')).toBe('A title');
        expect(nodeSnippet(heading, 'bn')).toBe('শিরোনাম');
        const text = createNode('text', { text: { bn: '', en: '<p>Some <b>bold</b>   words</p>' } });
        expect(nodeSnippet(text, 'bn')).toBe('Some bold words');
        expect(nodeSnippet(createNode('divider'), 'en')).toBe('');
    });
});

describe('publishing checks for a tree', () => {
    it('refuses containers nested deeper than three', () => {
        expect(documentIssues({ sections: [free([nested(NODE_LIMITS.depth)])] })).toEqual([]);
        const deep = free([nested(NODE_LIMITS.depth + 1)]);
        const fourth = deep.children![0]!.children![0]!.children![0]!.children![0]!;
        expect(documentIssues({ sections: [deep] })).toEqual([
            { sectionId: 'free0001', blockId: fourth.uid, field: 'sections', code: 'tooDeep' },
        ]);
        // Whatever was stored, reading stops a few levels further down.
        const read = readSection(JSON.parse(JSON.stringify(free([nested(12)]))))!;
        expect(nodeDepth(read.children!)).toBe(6);
    });

    it('refuses more than 400 nodes on a page', () => {
        const many = (count: number, uid: string) =>
            free(
                Array.from({ length: count }, () => createNode('divider')),
                uid,
            );
        expect(documentIssues({ sections: [many(200, 'free0001'), many(200, 'free0002')] })).toEqual([]);
        expect(documentIssues({ sections: [many(200, 'free0001'), many(201, 'free0002')] })).toEqual([
            { sectionId: 'free0002', field: 'sections', code: 'tooManyNodes' },
        ]);
    });

    it('reports broken links in elements and in live blocks, by their node', () => {
        const button = createNode('button', { link: { type: 'url', url: 'not a link' } });
        const banner = createSection('banner');
        banner.settings.link = { type: 'anchor', anchor: '' };
        const opened = openSection(createSection('faq'))!.children![0]!;
        const liveBanner: NodeData = { ...opened, section: banner };
        const section = free([createNode('container'), button, liveBanner]);
        section.children![0]!.children = [createNode('video', { video: 'https://example.com/x' })];
        expect(documentIssues({ sections: [section] })).toEqual([
            {
                sectionId: 'free0001',
                blockId: section.children![0]!.children![0]!.uid,
                field: 'video',
                code: 'invalidVideo',
            },
            { sectionId: 'free0001', blockId: button.uid, field: 'link', code: 'invalidUrl' },
            { sectionId: 'free0001', blockId: liveBanner.uid, field: 'link', code: 'invalidAnchor' },
        ]);
    });

    it('counts an order form inside a live block', () => {
        const form = createSection('order-form');
        const opened = openSection(createSection('order-form'))!;
        opened.style.anchor = '';
        expect(documentIssues({ sections: [form, opened] })).toEqual([
            {
                sectionId: opened.uid,
                blockId: opened.children![0]!.uid,
                field: 'sections',
                code: 'duplicateOrderForm',
            },
        ]);
    });
});

describe('references in a tree', () => {
    const image = (assetId: string) => ({ assetId, preview: '' });
    const build = () => {
        const grid = createSection('product-grid');
        grid.settings.source = 'manual';
        grid.settings.products = ['7', '8'];
        const liveGrid = openSection(grid)!.children![0]!;
        const column = createNode('container');
        column.children = [
            createNode('image', { image: image('3'), link: { type: 'category', ref: '5' } }),
            { ...createNode('image', { image: image('4') }), hidden: true },
            liveGrid,
        ];
        return free([column, createNode('button', { link: { type: 'page', ref: '9' } })]);
    };

    it('lists what shown nodes refer to, live blocks included', () => {
        const section = build();
        expect(documentRefs({ sections: [section] })).toEqual({
            products: ['7', '8'],
            collections: ['5'],
            pages: ['9'],
            assets: ['3'],
        });
        expect(documentRefs({ sections: [section] }, { includeHidden: true }).assets).toEqual(['3', '4']);
        expect(documentRefs({ sections: [{ ...section, hidden: true }] }).products).toEqual([]);
    });

    it('maps every ID and link, and visits every field', () => {
        const section = build();
        const mapped = mapDocumentIds({ sections: [section] }, (_kind, id, top) => {
            expect(top).toBe(section);
            return `T_${id}`;
        });
        const column = mapped.sections[0]!.children![0]!;
        expect(column.children![0]!.props).toMatchObject({
            image: { assetId: 'T_3' },
            link: { type: 'category', ref: 'T_5' },
        });
        expect(column.children![2]!.section!.settings.products).toEqual(['T_7', 'T_8']);
        // The original is left as it was.
        expect(section.children![0]!.children![0]!.props.image).toEqual(image('3'));

        const linked = mapLinks({ sections: [section] }, link => ({ ...link, href: '/x/' }));
        expect(linked.sections[0]!.children![1]!.props.link).toEqual({ type: 'page', ref: '9', href: '/x/' });
        // The storefront keeps the core's addresses.
        expect(readDocument(linked, { keepHrefs: true }).sections[0]!.children![1]!.props.link).toMatchObject(
            {
                href: '/x/',
            },
        );

        const visits = [...eachField({ sections: [section] })];
        const products = visits.find(visit => visit.name === 'products')!;
        expect(products.section).toBe(section);
        expect(products.owner.type).toBe('product-grid');
        expect(products.node!.type).toBe('live');
        expect(visits.find(visit => visit.name === 'tag')).toBeUndefined();
        expect(visits.filter(visit => visit.node?.type === 'image' && visit.name === 'alt')).toHaveLength(2);
    });

    it('finds ready-made sections on the page and inside live blocks', () => {
        const hero = createSection('hero');
        const section = build();
        const hiddenLive = { ...openSection(createSection('faq'))!.children![0]!, hidden: true };
        section.children!.push(hiddenLive);
        const document = { sections: [hero, section] };
        expect(smartSections(document).map(item => item.section.type)).toEqual([
            'hero',
            'product-grid',
            'faq',
        ]);
        expect(shownSmartSections(document).map(item => item.type)).toEqual(['hero', 'product-grid']);
    });
});

describe('the stylesheet for a tree', () => {
    it('lays out containers and styles each node, per device', () => {
        const grid = createStructure(STRUCTURE_PRESETS.find(preset => preset.key === 'grid-4')!);
        grid.uid = 'grid0001';
        grid.props.phoneOrder = 'reverse';
        const [first, second] = grid.children!;
        first!.uid = 'cell0001';
        first!.props = {
            ...first!.props,
            direction: 'row',
            wrap: true,
            gap: 8,
            justify: 'space-between',
            align: 'center',
        };
        const heading = { ...createNode('heading'), uid: 'head0001' };
        heading.style = {
            base: {
                color: '#aa0000',
                fontSize: 64,
                fontWeight: '300',
                textAlign: 'center',
                width: 80,
                borderWidth: 1,
            },
            tablet: { fontSize: 40, textAlign: 'end' },
            phone: { fontSize: 32, width: 100, borderColor: '#dddddd' },
        };
        first!.children = [heading, { ...createNode('spacer', { height: 48 }), uid: 'space001' }];
        second!.children = [{ ...createNode('divider'), uid: 'line0001' }];
        const css = layoutCss({ sections: [free([grid])] });
        expect(css).toBe(
            [
                '.box[data-u="grid0001"]{display:grid;gap:24px 24px;grid-template-columns:repeat(4,minmax(0,1fr))}',
                '.box[data-u="cell0001"]{flex-direction:row;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center}',
                '.el[data-u="head0001"]{color:#aa0000;--el-color:#aa0000;font-size:clamp(40px,5vw,64px);--el-size:clamp(40px,5vw,64px);font-weight:300;--el-weight:300;text-align:center;--el-align:center;width:80%;flex:none;border:1px solid currentColor}',
                '.el[data-u="space001"]{height:48px}',
                '@media (max-width:989px){',
                '.box[data-u="grid0001"]{grid-template-columns:repeat(2,minmax(0,1fr))}',
                '.el[data-u="head0001"]{font-size:40px;--el-size:40px;text-align:end;--el-align:end}',
                '}@media (max-width:749px){',
                '.box[data-u="grid0001"]>:last-child{order:-1}',
                '.box[data-u="grid0001"]{grid-template-columns:minmax(0,1fr)}',
                '.box[data-u="cell0001"]{flex-direction:column}',
                '.el[data-u="head0001"]{font-size:32px;--el-size:32px;width:100%;flex:none;border:1px solid #dddddd}',
                '}',
            ].join(''),
        );
    });

    it('writes nothing for what does not show, or for values that skipped reading', () => {
        const empty = createStructure(STRUCTURE_PRESETS[1]);
        const hidden = { ...createNode('heading'), hidden: true, style: { base: { color: '#000000' } } };
        expect(layoutCss({ sections: [free([empty, hidden])] })).toBe('');
        const forged = createNode('heading');
        forged.style = { base: { color: 'red}body{display:none' as never, width: '50;x' as never } };
        const badId = { ...createNode('heading'), uid: 'x"]{', style: { base: { color: '#000000' } } };
        expect(layoutCss({ sections: [free([forged, badId])] })).toBe('');
        // A container that only stacks its children needs no rule of its own.
        const plain = createNode('container');
        plain.children = [createNode('divider')];
        expect(layoutCss({ sections: [free([plain])] })).toBe('');
    });
});

describe('pages made before the tree', () => {
    it('turns the Custom section into a grid container with a container per column', () => {
        const document = readDocument({ sections: [OLD_CUSTOM] });
        const section = document.sections[0]!;
        expect(section).toMatchObject({ uid: 'custom01', type: 'custom', v: 2, settings: {}, blocks: [] });
        const [grid] = section.children!;
        expect(grid).toMatchObject({
            uid: 'custom01g',
            type: 'container',
            props: {
                mode: 'grid',
                columns: '1-2',
                gap: 40,
                rowGap: 24,
                align: 'start',
                stack: true,
                phoneOrder: 'reverse',
            },
        });
        const [left, right] = grid!.children!;
        expect(grid!.children!.map(column => column.uid)).toEqual(['custom01c1', 'custom01c2']);
        expect(left!.props).toMatchObject({ mode: 'flex', direction: 'column', gap: 16 });
        // Elements keep their IDs and their order down each column; an unknown kind is a heading.
        expect(left!.children!.map(node => [node.uid, node.type])).toEqual([
            ['elem0001', 'image'],
            ['elem0005', 'heading'],
        ]);
        expect(right!.children!.map(node => [node.uid, node.type])).toEqual([
            ['elem0002', 'heading'],
            ['elem0003', 'icon-list'],
            ['elem0004', 'spacer'],
        ]);
        expect(right!.children![0]).toMatchObject({
            props: { text: { bn: 'শিরোনাম', en: 'Heading' }, tag: 'h3' },
            // A size or weight never applied to a heading before the tree, so it isn't carried over.
            style: { base: { color: '#aa0000' } },
        });
        expect(right!.children![1]!.props).toEqual({
            items: { bn: 'এক\nদুই', en: 'One\nTwo' },
            icon: 'leaf',
        });
        // Only checked values come through; a space only ever had a height.
        expect(left!.children![1]!.style).toEqual({ base: {} });
        // A list's size did apply, on computers and on phones: it's kept.
        expect(right!.children![1]!.style).toEqual({ base: { fontSize: 20 }, phone: { fontSize: 16 } });
        expect(right!.children![2]).toMatchObject({ props: { height: 48 }, style: { base: {} } });
    });

    it('writes the same styles the Custom section did', () => {
        const css = layoutCss(readDocument({ sections: [OLD_CUSTOM] }));
        expect(css).toContain(
            '.box[data-u="custom01g"]{display:grid;gap:24px 40px;grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:start}',
        );
        expect(css).toContain(
            '.el[data-u="elem0001"]{text-align:center;--el-align:center;width:80%;margin-inline:auto;border-radius:12px;--radius:12px}',
        );
        expect(css).toContain('.el[data-u="elem0002"]{color:#aa0000;--el-color:#aa0000}');
        expect(css).toContain('.el[data-u="elem0004"]{height:48px}');
        expect(css).toContain(
            '@media (max-width:749px){.box[data-u="custom01g"]>:last-child{order:-1}.box[data-u="custom01g"]{grid-template-columns:minmax(0,1fr)}.el[data-u="elem0003"]{font-size:16px;--el-size:16px}}',
        );
        // The columns themselves need no rule: the theme stacks every container's children.
        expect(css).not.toContain('custom01c1');
    });

    it('reads the same tree every time, and an empty Custom section as an empty tree', () => {
        expect(readDocument({ sections: [OLD_CUSTOM] })).toEqual(readDocument({ sections: [OLD_CUSTOM] }));
        expect(readSection({ ...OLD_CUSTOM, blocks: [] })!.children).toEqual([]);
        // Saved by the new editor, it is read as it is.
        const saved = JSON.parse(JSON.stringify(readDocument({ sections: [OLD_CUSTOM] })));
        expect(readDocument(saved)).toEqual(readDocument({ sections: [OLD_CUSTOM] }));
    });

    it('starts a new free section with a photo beside a heading, text and an order button', () => {
        const section = createSection('custom');
        const [grid] = section.children!;
        expect(grid!.props).toMatchObject({ mode: 'grid', columns: '1-1' });
        expect(grid!.children!.map(column => column.children!.map(node => node.type))).toEqual([
            ['image'],
            ['heading', 'text', 'button'],
        ]);
        expect(grid!.children![1]!.children![2]!.props.link).toEqual({ type: 'anchor', anchor: 'order' });
        expect(documentIssues({ sections: [section] })).toEqual([]);
    });
});

describe('opening a section up', () => {
    it('opens every ready-made section into a free section that can be published', () => {
        for (const definition of SECTIONS.filter(item => !item.tree)) {
            const section = createSection(definition.type);
            section.style.anchor = 'here';
            const opened = openSection(section)!;
            expect(opened).toMatchObject({ uid: section.uid, type: 'custom', style: { anchor: 'here' } });
            expect(opened.children!.length).toBeGreaterThan(0);
            expect(nodeDepth(opened.children!)).toBeLessThanOrEqual(NODE_LIMITS.depth);
            expect(documentIssues({ sections: [opened] })).toEqual([]);
            // Stable when stored and read back.
            expect(readSection(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
            const types = [...eachNode(opened.children!)].map(({ node }) => node.type);
            if (!opensToElements(definition.type)) expect(types).toEqual(['live']);
        }
        expect(openSection(createSection('custom'))).toBeNull();
    });

    it('turns words, pictures and buttons into elements', () => {
        const section = createSection('image-with-text');
        section.settings.image = { assetId: '3', preview: '' };
        section.settings.imagePosition = 'right';
        section.settings.button = { bn: 'দেখুন', en: 'See more' };
        section.settings.link = { type: 'search' };
        const [grid] = openSection(section)!.children!;
        expect(grid!.props).toMatchObject({ mode: 'grid', columns: '1-1', phoneOrder: 'reverse' });
        expect(grid!.children!.map(column => column.children!.map(node => node.type))).toEqual([
            ['heading', 'text', 'container'],
            ['image'],
        ]);
        expect(grid!.children![0]!.children![0]!.props.text).toEqual(section.settings.heading);
    });

    it('keeps a hero’s image as the background when its text is on the image', () => {
        const section = createSection('hero');
        section.settings.image = { assetId: '3', preview: '/hero.jpg' };
        const overlay = openSection(section)!;
        expect(overlay.style).toMatchObject({ background: 'image', backgroundImage: { assetId: '3' } });
        expect(overlay.children!.map(node => node.type)).toEqual(['container']);
        section.settings.layout = 'split';
        const split = openSection(section)!;
        expect(split.style.background).toBe('none');
        expect(split.children![0]!.props.mode).toBe('grid');
    });

    it('keeps live data as one live block that works as before', () => {
        const section = createSection('product-grid');
        section.settings.source = 'manual';
        section.settings.products = ['7'];
        const opened = openSection(section)!;
        const [node] = opened.children!;
        expect(node!.type).toBe('live');
        expect(node!.section).toMatchObject({ type: 'product-grid', settings: section.settings });
        expect(node!.section!.uid).not.toBe(section.uid);
        expect(documentRefs({ sections: [opened] }).products).toEqual(['7']);
    });

    it('opens every starter and sales template without problems', () => {
        const layouts = [
            ...STARTERS.map(name => starterLayout(name)),
            ...LANDING_TEMPLATES.map(template => landingTemplate(template.id)!.build(product)),
        ];
        expect(layouts.length).toBeGreaterThanOrEqual(16);
        for (const layout of layouts) {
            const opened = { sections: layout.sections.map(section => openSection(section) ?? section) };
            // One order form is still one order form.
            expect(documentIssues(opened)).toEqual(documentIssues(layout));
            expect(readDocument(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
        }
    });
});

describe('a node’s own options (phase 58)', () => {
    it('reads an anchor, class names and the screen sizes it hides on, leaving them out when empty', () => {
        const section = readSection({
            type: 'custom',
            v: 2,
            children: [
                {
                    uid: 'head0001',
                    type: 'heading',
                    anchor: ' Size Guide! ',
                    cssClass: 'promo  big-title 9bad "x" promo a{b} one two three four',
                    hideOn: ['phone', 'watch', 'phone', 'base'],
                },
                {
                    uid: 'head0002',
                    type: 'heading',
                    anchor: '',
                    cssClass: 42,
                    hideOn: 'phone',
                    animate: 'spin',
                },
                { uid: 'head0003', type: 'heading', animate: 'rise' },
            ],
        })!;
        expect(section.children![0]).toMatchObject({
            anchor: 'size-guide',
            cssClass: 'promo big-title one two three',
            hideOn: ['base', 'phone'],
        });
        const plain = section.children![1]!;
        expect('anchor' in plain || 'cssClass' in plain || 'hideOn' in plain || 'animate' in plain).toBe(
            false,
        );
        // An entrance animation is one of the few we ship, or none.
        expect(section.children![2]!.animate).toBe('rise');
        expect(readClasses('ok also-ok _no -no')).toBe('ok also-ok');
    });

    it('hides a node on one screen size only', () => {
        const heading = { ...createNode('heading'), uid: 'head0001', hideOn: ['tablet'] as Device[] };
        const everywhere = { ...createNode('text'), uid: 'text0001', hideOn: ['base', 'phone'] as Device[] };
        expect(layoutCss({ sections: [free([heading, everywhere])] })).toBe(
            [
                '@media (min-width:750px) and (max-width:989px){.el[data-u="head0001"]{display:none}}',
                '@media (min-width:990px){.el[data-u="text0001"]{display:none}}',
                '@media (max-width:749px){.el[data-u="text0001"]{display:none}}',
            ].join(''),
        );
    });

    it('refuses an ID used twice, by a section or by a node', () => {
        const first = { ...createNode('heading'), anchor: 'offer' };
        const second = { ...createNode('heading'), anchor: 'offer' };
        const third = { ...createNode('heading'), anchor: 'order' };
        const form = createSection('order-form');
        expect(form.style.anchor).toBe('order');
        expect(documentIssues({ sections: [form, free([first, second, third])] })).toEqual([
            { sectionId: 'free0001', blockId: second.uid, field: 'anchor', code: 'duplicateAnchor' },
            { sectionId: 'free0001', blockId: third.uid, field: 'anchor', code: 'duplicateAnchor' },
        ]);
    });
});

describe('the element library (phase 61)', () => {
    it('splits an element’s lines into their parts', () => {
        expect(parseRows('How? | Like this\n\n  Why? |  Because | of this  \nNo answer')).toEqual([
            ['How?', 'Like this'],
            ['Why?', 'Because | of this'],
            ['No answer', ''],
        ]);
        expect(parseRows('Price | ৳650 | ৳900', 3)).toEqual([['Price', '৳650', '৳900']]);
        expect(parseRows('One\nTwo', 1)).toEqual([['One'], ['Two']]);
        expect(parseRows('')).toEqual([]);
    });

    it('offers every ready-made section as a block that keeps its settings', () => {
        const blocks = SECTIONS.filter(definition => !definition.tree);
        for (const definition of blocks) {
            const node = liveBlock(definition.type);
            expect(node).toMatchObject({ type: 'live', section: { type: definition.type } });
            expect(readSection(JSON.parse(JSON.stringify(free([node]))))!.children![0]).toEqual(node);
        }
        expect(() => liveBlock('custom')).toThrow();
        expect(() => liveBlock('nonsense')).toThrow();
        // With the elements, the picker passes seventy choices.
        const elements = ELEMENTS.filter(definition => !definition.internal);
        expect(elements.length + blocks.length).toBeGreaterThanOrEqual(64);
    });

    it('reads a web address and a plain line, and refuses an address that isn’t one', () => {
        const social = createNode('social', {
            facebook: ' https://facebook.com/rahimfashion ',
            instagram: 'javascript:alert(1)',
            youtube: '/a-path',
        });
        expect(social.props.facebook).toBe('https://facebook.com/rahimfashion');
        expect(
            documentIssues({ sections: [free([social])] }).map(issue => [issue.field, issue.code]),
        ).toEqual([
            ['instagram', 'invalidUrl'],
            ['youtube', 'invalidUrl'],
        ]);
        const email = createNode('email', { email: '  shop@example.com\n<script>  ' });
        expect(email.props.email).toBe('shop@example.com <script>');
    });

    it('gives the progress bar and the map their one number', () => {
        const bar = { ...createNode('progress', { percent: 40 }), uid: 'bar00001' };
        const map = { ...createNode('map', { place: 'Dhanmondi 27, Dhaka', height: 400 }), uid: 'map00001' };
        expect(layoutCss({ sections: [free([bar, map])] })).toBe(
            '.el[data-u="bar00001"]{--progress:40%}.el[data-u="map00001"]{--map-height:400px}',
        );
    });
});

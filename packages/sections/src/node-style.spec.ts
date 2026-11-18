import { describe, expect, it } from 'vitest';
import { layoutCss } from './css';
import type { SectionData } from './define';
import { createSection } from './document';
import { ELEMENTS } from './elements';
import {
    inheritedFrom,
    NODE_FONTS,
    NODE_STYLE_FIELDS,
    NODE_STYLE_PROPS,
    type NodeStyle,
    pasteStyle,
    readNodeStyle,
    STYLE_GROUPS,
    styleGroupsFor,
    withoutDevice,
} from './node-style';
import { createNode, type NodeData } from './nodes';

/** The stylesheet of a free section holding these nodes. */
function cssOf(...children: NodeData[]): string {
    const section: SectionData = { ...createSection('custom'), uid: 'free0001', children };
    return layoutCss({ sections: [section] });
}

function styled(type: string, uid: string, style: NodeStyle, props: Record<string, unknown> = {}): NodeData {
    return { ...createNode(type, props), uid, style };
}

describe('the style groups (phase 57)', () => {
    it('puts every property in one group, named in both languages', () => {
        const grouped = STYLE_GROUPS.flatMap(group => group.props as readonly string[]);
        expect([...grouped].sort()).toEqual([...NODE_STYLE_PROPS].sort());
        expect(new Set(grouped).size).toBe(grouped.length);
        for (const group of STYLE_GROUPS) expect(group.label.bn && group.label.en).toBeTruthy();
        for (const field of Object.values(NODE_STYLE_FIELDS))
            expect(field.label.bn && field.label.en).toBeTruthy();
    });

    it('offers each kind of node the groups that mean something for it', () => {
        const keys = (type: string) => styleGroupsFor(type).map(group => group.key);
        expect(keys('heading')).toEqual(['typography', 'spacing', 'background', 'border', 'sizing']);
        expect(keys('button')[0]).toBe('button');
        expect(keys('image')).toEqual(['image', 'spacing', 'background', 'border', 'sizing']);
        expect(keys('container')).toContain('background');
        expect(keys('spacer')).toEqual([]);
        // A container passes a colour, an alignment and a font down; it has no type size of its own.
        const text = styleGroupsFor('container').find(group => group.key === 'typography')!;
        expect(text.props).toEqual(['color', 'textAlign', 'fontFamily']);
        // Every element gets an answer.
        for (const definition of ELEMENTS) expect(Array.isArray(styleGroupsFor(definition.type))).toBe(true);
    });

    it('ends every font in letters for Bangla', () => {
        for (const stack of Object.values(NODE_FONTS)) {
            expect(stack).toMatch(/Bengali|Hind Siliguri|system-ui/);
        }
        expect(NODE_FONTS.serif).toContain('Noto Serif Bengali');
        expect(NODE_FONTS.mono).toContain('Hind Siliguri');
    });

    it('says where an unset value comes from, and clears one device', () => {
        const style: NodeStyle = { base: { fontSize: 40, color: '#111111' }, tablet: { fontSize: 30 } };
        expect(inheritedFrom(style, 'phone', 'fontSize')).toBe('tablet');
        expect(inheritedFrom(style, 'phone', 'color')).toBe('base');
        expect(inheritedFrom(style, 'tablet', 'fontSize')).toBe('base');
        expect(inheritedFrom(style, 'base', 'fontSize')).toBeNull();
        expect(inheritedFrom(style, 'phone', 'radius')).toBeNull();
        expect(withoutDevice(style, 'tablet')).toEqual({ base: style.base });
        expect(withoutDevice(style, 'base')).toEqual({ base: {}, tablet: { fontSize: 30 } });
        expect(withoutDevice(style, 'phone')).toEqual(style);
    });

    it('pastes a copied look, keeping only what the other node has and only checked values', () => {
        const copied = {
            base: { color: '#AA0000', buttonBg: '#00aa00', aspect: '1/1', padding: 12, position: 'fixed' },
            phone: { buttonBg: '#0000aa' },
            tablet: { fontSize: 'big' },
        };
        expect(pasteStyle(copied, 'heading')).toEqual({ base: { color: '#aa0000', padding: 12 } });
        expect(pasteStyle(copied, 'button')).toEqual({
            base: { color: '#aa0000', buttonBg: '#00aa00', padding: 12 },
            phone: { buttonBg: '#0000aa' },
        });
        expect(pasteStyle(copied, 'image')).toEqual({ base: { aspect: '1/1', padding: 12 } });
        expect(pasteStyle('nonsense', 'heading')).toEqual({ base: {} });
    });
});

describe('the stylesheet for each style group', () => {
    it('styles one heading differently on computers, tablets and phones', () => {
        const heading = styled('heading', 'head0001', {
            base: {
                fontSize: 48,
                fontWeight: '800',
                lineHeight: 1.1,
                letterSpacing: -1,
                textTransform: 'uppercase',
            },
            tablet: { fontSize: 36, letterSpacing: 0 },
            phone: { fontSize: 24, lineHeight: 1.3, textAlign: 'center', fontFamily: 'hind-siliguri' },
        });
        expect(cssOf(heading)).toBe(
            [
                '.el[data-u="head0001"]{font-size:clamp(30px,3.75vw,48px);--el-size:clamp(30px,3.75vw,48px);font-weight:800;--el-weight:800;line-height:1.1;--el-leading:1.1;letter-spacing:-1px;--el-tracking:-1px;text-transform:uppercase}',
                '@media (max-width:989px){.el[data-u="head0001"]{font-size:36px;--el-size:36px;letter-spacing:0px;--el-tracking:0px}}',
                `@media (max-width:749px){.el[data-u="head0001"]{font-size:24px;--el-size:24px;line-height:1.3;--el-leading:1.3;font-family:${NODE_FONTS['hind-siliguri']};text-align:center;--el-align:center}}`,
            ].join(''),
        );
    });

    it('writes spacing on four sides, a width and a height', () => {
        const box = styled('text', 'text0001', {
            base: {
                padding: 20,
                paddingTop: 40,
                marginTop: 8,
                marginLeft: 4,
                maxWidth: 640,
                minHeight: 200,
                textAlign: 'center',
            },
            phone: { padding: 12, marginTop: 0 },
        });
        expect(cssOf(box)).toBe(
            [
                '.el[data-u="text0001"]{text-align:center;--el-align:center;max-width:640px;margin-inline:auto;min-height:200px;padding:20px;padding-top:40px;margin-top:8px;margin-left:4px}',
                // A phone's "all sides" would wipe the computer's top space, so that is written again.
                '@media (max-width:749px){.el[data-u="text0001"]{padding:12px;padding-top:40px;margin-top:0px}}',
            ].join(''),
        );
    });

    it('writes a plain colour, or a gradient when there is a second one', () => {
        expect(cssOf(styled('container', 'box00001', { base: { background: '#112233' } }, {}))).toBe('');
        const filled = (style: NodeStyle) => {
            const box = styled('container', 'box00001', style);
            box.children = [createNode('divider')];
            return cssOf(box);
        };
        expect(filled({ base: { background: '#112233' } })).toBe(
            '.box[data-u="box00001"]{background:#112233}',
        );
        expect(filled({ base: { background: '#112233', gradientTo: '#445566' } })).toBe(
            '.box[data-u="box00001"]{background:linear-gradient(180deg,#112233,#445566)}',
        );
        // A phone changes only the direction: the colours come from the computer.
        expect(
            filled({
                base: { background: '#112233', gradientTo: '#445566', gradientAngle: 90 },
                phone: { gradientAngle: 0 },
            }),
        ).toBe(
            '.box[data-u="box00001"]{background:linear-gradient(90deg,#112233,#445566)}@media (max-width:749px){.box[data-u="box00001"]{background:linear-gradient(0deg,#112233,#445566)}}',
        );
        // A second colour alone is nothing.
        expect(filled({ base: { gradientTo: '#445566' } })).toBe('');
    });

    it('writes a border with its style, corners, a shadow and opacity', () => {
        const card = styled('quote', 'card0001', {
            base: {
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#cccccc',
                radius: 12,
                shadow: 'm',
                opacity: 90,
            },
            tablet: { borderStyle: 'dotted', shadow: 'none' },
            phone: { borderWidth: 0 },
        });
        expect(cssOf(card)).toBe(
            [
                '.el[data-u="card0001"]{border-radius:12px;--radius:12px;border:2px dashed #cccccc;box-shadow:0 4px 12px rgb(0 0 0/.1);opacity:0.9}',
                '@media (max-width:989px){.el[data-u="card0001"]{border:2px dotted #cccccc;box-shadow:none}}',
                '@media (max-width:749px){.el[data-u="card0001"]{border:0}}',
            ].join(''),
        );
    });

    it('shapes an image and chooses what stays in view', () => {
        const image = styled('image', 'img00001', {
            base: { aspect: '1/1', objectPosition: 'top' },
            phone: { aspect: '4/3', objectFit: 'contain' },
        });
        expect(cssOf(image)).toBe(
            [
                '.el[data-u="img00001"] img{aspect-ratio:1/1;object-fit:cover;object-position:center top}',
                '@media (max-width:749px){.el[data-u="img00001"] img{aspect-ratio:4/3;object-fit:contain}}',
            ].join(''),
        );
    });

    it('colours a button, when pointed at too, and sizes it', () => {
        const button = styled('button', 'btn00001', {
            base: {
                buttonBg: '#0b3d2e',
                buttonText: '#ffffff',
                buttonHoverBg: '#f5b301',
                buttonHoverText: '#111111',
                buttonPaddingX: 32,
                buttonPaddingY: 14,
                fontWeight: '700',
                radius: 2,
            },
            phone: { buttonBorder: '#000000', buttonPaddingX: 16 },
        });
        expect(cssOf(button)).toBe(
            [
                '.el[data-u="btn00001"]{font-weight:700;--el-weight:700;border-radius:2px;--radius:2px}',
                '.el[data-u="btn00001"] .button{background:#0b3d2e;border-color:#0b3d2e;color:#ffffff;padding:14px 32px}',
                '.el[data-u="btn00001"] .button:hover{background:#f5b301;border-color:#f5b301;opacity:1;color:#111111}',
                '@media (max-width:749px){.el[data-u="btn00001"] .button{border-color:#000000;padding:14px 16px}}',
            ].join(''),
        );
    });

    it('sizes a node inside a row, and places it', () => {
        const row = styled('container', 'row00001', { base: {} }, { direction: 'row' });
        const left = styled('container', 'left0001', { base: { width: 30 } });
        const right = styled('container', 'right001', { base: { flexGrow: 2, alignSelf: 'end' } });
        left.children = [createNode('divider')];
        right.children = [createNode('divider')];
        row.children = [left, right];
        expect(cssOf(row)).toBe(
            [
                '.box[data-u="row00001"]{flex-direction:row}',
                '.box[data-u="left0001"]{width:30%;flex:none}',
                '.box[data-u="right001"]{align-self:flex-end;flex-grow:2}',
                '@media (max-width:749px){.box[data-u="row00001"]{flex-direction:column}}',
            ].join(''),
        );
    });

    it('shades a container’s background image', () => {
        const box = styled(
            'container',
            'box00001',
            { base: {} },
            { image: { assetId: '3', preview: '' }, shade: 40 },
        );
        box.children = [createNode('divider')];
        expect(cssOf(box)).toBe('.box[data-u="box00001"]{--box-shade:0.4}');
    });

    it('never writes a value that skipped reading', () => {
        const forged = {
            color: 'red}body{display:none',
            fontFamily: 'x;}body{',
            textTransform: 'expression(1)',
            aspect: '1/1;x',
            objectFit: 'cover;x',
            objectPosition: 'top;x',
            shadow: 'xx',
            alignSelf: 'x',
            borderStyle: 'x;',
            borderWidth: 2,
            buttonBg: 'url(x)',
            gradientTo: 'x',
            background: '#112233',
            lineHeight: '1;x',
        } as never;
        expect(cssOf(styled('button', 'btn00001', { base: forged, phone: forged }))).toBe(
            '.el[data-u="btn00001"]{background:#112233;border:2px solid currentColor}@media (max-width:749px){.el[data-u="btn00001"]{background:#112233;border:2px solid currentColor}}',
        );
        // Read first, as every stored style is, none of it is there at all.
        expect(readNodeStyle({ base: forged })).toEqual({ base: { background: '#112233', borderWidth: 2 } });
    });
});

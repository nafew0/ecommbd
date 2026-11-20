import { describe, expect, it } from 'vitest';
import { layoutCss } from './css';
import { createSection, readDocument } from './document';
import { createNode } from './nodes';
import {
    mergedStyle,
    newStyleKey,
    readSavedStyles,
    SAVED_STYLE_LIMIT,
    type SavedStyle,
    savedStyleKind,
    withSavedStyles,
} from './saved-styles';
import { defaultThemeSettings, readThemeSettings } from './theme';

const big: SavedStyle = {
    key: 'bighead1',
    name: 'Big heading',
    kind: 'text',
    style: { base: { fontSize: 40, color: '#0b3d2e' }, phone: { fontSize: 26 } },
};
const order: SavedStyle = {
    key: 'orderbtn',
    name: 'Order button',
    kind: 'button',
    style: { base: { buttonBg: '#b3261e', buttonText: '#ffffff' } },
};

function page(...nodes: ReturnType<typeof createNode>[]) {
    const section = createSection('custom');
    section.children = nodes;
    return { sections: [section] };
}

describe('saved styles (phase 62)', () => {
    it('says which kind of saved style an element can use', () => {
        expect(savedStyleKind('heading')).toBe('text');
        expect(savedStyleKind('text')).toBe('text');
        expect(savedStyleKind('button')).toBe('button');
        expect(savedStyleKind('whatsapp')).toBe('button');
        expect(savedStyleKind('container')).toBeNull();
        expect(savedStyleKind('spacer')).toBeNull();
        expect(savedStyleKind('live')).toBeNull();
    });

    it('reads stored styles: checked values, unique keys, a name, at most the limit', () => {
        const read = readSavedStyles([
            big,
            { ...big, name: 'Same key again' },
            { key: 'nonameaa', name: '   ', kind: 'text', style: {} },
            { key: 'BAD KEY', name: 'x', kind: 'text', style: {} },
            { key: 'wrongkin', name: 'x', kind: 'image', style: {} },
            // A text style can't carry a button's colours, nor a value that isn't one.
            {
                key: 'mixedup1',
                name: '  Mixed   up ',
                kind: 'text',
                style: { base: { buttonBg: '#000000', fontSize: 'huge', fontWeight: '700' } },
            },
            'nonsense',
        ]);
        expect(read.map(style => style.key)).toEqual(['bighead1', 'mixedup1']);
        expect(read[0]).toEqual(big);
        expect(read[1]).toMatchObject({ name: 'Mixed up', style: { base: { fontWeight: '700' } } });
        expect(readSavedStyles('nope')).toEqual([]);
        // A new style's key is one this reader takes.
        const key = newStyleKey();
        expect(readSavedStyles([{ ...big, key }])[0]!.key).toBe(key);
        const many = Array.from({ length: 40 }, (_, index) => ({
            ...big,
            key: `style${String(index).padStart(3, '0')}`,
        }));
        expect(readSavedStyles(many)).toHaveLength(SAVED_STYLE_LIMIT);
    });

    it('keeps them in the theme settings', () => {
        expect(defaultThemeSettings().styles).toEqual([]);
        const theme = readThemeSettings({ ...defaultThemeSettings(), styles: [big, order] });
        expect(theme.styles).toEqual([big, order]);
        expect(readThemeSettings({}).styles).toEqual([]);
    });

    it('puts an element’s own choices on top of its saved style, on each screen', () => {
        expect(mergedStyle(big.style, { base: { color: '#aa0000' }, tablet: { fontSize: 32 } })).toEqual({
            base: { fontSize: 40, color: '#aa0000' },
            tablet: { fontSize: 32 },
            phone: { fontSize: 26 },
        });
        expect(mergedStyle({ base: {} }, { base: {} })).toEqual({ base: {} });
    });

    it('folds saved styles into the page’s stylesheet, and one change reaches every element', () => {
        const plain = { ...createNode('heading'), uid: 'plain001' };
        const styled = { ...createNode('heading'), uid: 'styled01', styleRef: big.key };
        const own = {
            ...createNode('heading'),
            uid: 'ownone01',
            styleRef: big.key,
            style: { base: { color: '#aa0000' } },
        };
        const button = { ...createNode('button'), uid: 'button01', styleRef: order.key };
        // Pointing at a style of the wrong kind, or one that is gone: its own look.
        const wrong = { ...createNode('button'), uid: 'wrong001', styleRef: big.key };
        const gone = { ...createNode('heading'), uid: 'gone0001', styleRef: 'deleted1' };
        const holder = { ...createNode('container'), uid: 'holder01' };
        holder.children = [styled, own];
        const document = readDocument(JSON.parse(JSON.stringify(page(plain, holder, button, wrong, gone))));
        expect(document.sections[0]!.children![1]!.children![0]!.styleRef).toBe(big.key);

        const css = layoutCss(withSavedStyles(document, [big, order]));
        expect(css).toContain('.el[data-u="styled01"]{color:#0b3d2e');
        expect(css).toContain('.el[data-u="ownone01"]{color:#aa0000');
        expect(css).toContain('font-size:clamp(');
        expect(css).toContain('button01');
        expect(css).not.toContain('plain001');
        expect(css).not.toContain('wrong001');
        expect(css).not.toContain('gone0001');

        // The saved style changes: both headings follow, the one with its own colour keeps it.
        const darker = { ...big, style: { base: { fontSize: 40, color: '#111111' } } };
        const after = layoutCss(withSavedStyles(document, [darker, order]));
        expect(after).toContain('.el[data-u="styled01"]{color:#111111');
        expect(after).toContain('.el[data-u="ownone01"]{color:#aa0000');
        // Nothing saved, or nothing using a style: the document itself.
        expect(withSavedStyles(document, [])).toBe(document);
        const untouched = page(plain);
        expect(withSavedStyles(untouched, [big])).toBe(untouched);
        // A key that isn't one is dropped on reading.
        const bad = readDocument(JSON.parse(JSON.stringify(page({ ...plain, styleRef: 'NOT A KEY' }))));
        expect(bad.sections[0]!.children![0]).not.toHaveProperty('styleRef');
    });
});

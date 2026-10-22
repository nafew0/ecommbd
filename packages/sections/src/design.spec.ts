import { describe, expect, it } from 'vitest';
import { layoutCss } from './css';
import type { SectionData } from './define';
import { createSection, readDocument, readSection } from './document';
import { field, readSize, readValue } from './fields';
import { DESIGN_FIELDS, DESIGN_GROUPS, hasDesign, readDesign, readStyle } from './style';

const label = { bn: 'লেবেল', en: 'Label' };

describe('Design field kinds', () => {
    it('reads any hex colour, or nothing', () => {
        const hex = field.hex(label);
        expect(readValue(hex, '#AABBCC')).toBe('#aabbcc');
        expect(readValue(hex, '#abc')).toBe('#aabbcc');
        expect(readValue(hex, '')).toBe('');
        expect(readValue(hex, 'red;background:url(x)')).toBe('');
        expect(readValue(hex, 42)).toBe('');
    });

    it('reads sizes within limits and on steps, empty meaning automatic', () => {
        const size = field.size(label, { min: 0, max: 200, step: 4 });
        expect(size.unit).toBe('px');
        expect(readValue(size, 37)).toBe(36);
        expect(readValue(size, '38')).toBe(40);
        expect(readValue(size, 900)).toBe(200);
        expect(readValue(size, -5)).toBe(0);
        expect(readValue(size, '')).toBeNull();
        expect(readValue(size, null)).toBeNull();
        expect(readValue(size, 'big')).toBeNull();
        expect(readSize(1.234, { min: 0, max: 2, step: 0.01 })).toBe(1.23);
    });

    it('reads dates as UTC and money as whole taka in poisha', () => {
        const datetime = field.datetime(label);
        expect(readValue(datetime, '2026-12-01T20:00:00+06:00')).toBe('2026-12-01T14:00:00.000Z');
        expect(readValue(datetime, 'tomorrow')).toBe('');
        expect(readValue(datetime, 5)).toBe('');
        const money = field.money(label);
        expect(readValue(money, 49_950)).toBe(50_000);
        expect(readValue(money, '120000')).toBe(120_000);
        expect(readValue(money, -100)).toBeNull();
        expect(readValue(money, '')).toBeNull();
        expect(readValue(money, 1e12)).toBe(1_000_000_000);
    });
});

describe('Design options', () => {
    it('start empty and read back only checked values', () => {
        const empty = readDesign(undefined);
        expect(hasDesign(empty)).toBe(false);
        expect(Object.keys(empty).sort()).toEqual(Object.keys(DESIGN_FIELDS).sort());
        const design = readDesign({
            background: '#FFF8E7',
            paddingTop: 41,
            width: 5000,
            headingWeight: '900',
            radius: '8',
            extra: 'nope',
        });
        expect(design).toMatchObject({
            background: '#fff8e7',
            paddingTop: 40,
            width: 1600,
            headingWeight: '',
            radius: 8,
        });
        expect(design).not.toHaveProperty('extra');
        expect(hasDesign(design)).toBe(true);
    });

    it('groups every option once for the editor', () => {
        const grouped = DESIGN_GROUPS.flatMap(group => group.fields);
        expect(new Set(grouped).size).toBe(grouped.length);
        expect(grouped.sort()).toEqual(Object.keys(DESIGN_FIELDS).sort());
        for (const group of DESIGN_GROUPS) expect(group.label.bn && group.label.en).toBeTruthy();
    });

    it('are part of every section style, with the order button and right alignment', () => {
        const style = readStyle({ align: 'end', orderButton: true, design: { text: '#111111' } });
        expect(style.align).toBe('end');
        expect(style.orderButton).toBe(true);
        expect(style.design.text).toBe('#111111');
        expect(readStyle(undefined).design).toEqual(readDesign({}));
        expect(readStyle({ orderButton: 'yes' }, { orderButton: true }).orderButton).toBe(true);
        // Old stored styles (phase 15) read without the new keys.
        const old = readSection({ uid: 'abcd1234', type: 'rich-text', v: 1, style: { spacing: 'l' } })!;
        expect(old.style).toMatchObject({ spacing: 'l', orderButton: false });
        expect(hasDesign(old.style.design)).toBe(false);
    });
});

const styled = (overrides: Partial<SectionData['style']['design']>, type = 'rich-text'): SectionData => {
    const section = createSection(type);
    return readSection({ ...section, style: { ...section.style, design: overrides } })!;
};

describe('the generated stylesheet', () => {
    it('is empty when nothing is styled', () => {
        expect(layoutCss({ sections: [createSection('rich-text'), createSection('faq')] })).toBe('');
    });

    it('sets custom properties on the section, with phone values in a media query', () => {
        const section = styled({
            background: '#102030',
            text: '#ffffff',
            button: '#ffcc00',
            paddingTop: 80,
            paddingBottom: 64,
            paddingTopPhone: 24,
            paddingBottomPhone: 16,
            width: 960,
            radius: 4,
            borderWidth: 2,
            headingSize: 48,
            headingSizePhone: 28,
            headingWeight: '800',
            textSize: 18,
            shade: 40,
        });
        const css = layoutCss({ sections: [section] });
        const selector = `.section[data-u="${section.uid}"]`;
        expect(css.startsWith(`${selector}{`)).toBe(true);
        for (const part of [
            '--section-bg:#102030',
            'background:#102030',
            'color:#ffffff',
            '--accent:#ffcc00',
            '--on-accent:#',
            '--pad-top:80px',
            '--pad-bottom:64px',
            '--content-width:960px',
            '--radius:4px',
            'border:2px solid var(--line)',
            '--heading-size:clamp(30px,3.75vw,48px)',
            '--heading-weight:800',
            'font-size:18px',
            '--shade:0.4',
        ]) {
            expect(css).toContain(part);
        }
        expect(css).toContain(
            `@media (max-width:749px){${selector}{--pad-top:24px;--pad-bottom:16px;--heading-size:28px}}`,
        );
    });

    it('styles Custom section elements, and only spaces get a height', () => {
        const section = createSection('custom');
        const [image, heading] = section.blocks;
        Object.assign(heading!.settings, {
            color: '#aa0000',
            size: 64,
            sizePhone: 32,
            weight: '700',
            align: 'center',
        });
        Object.assign(image!.settings, { width: 80, radius: 12, padding: 8, spaceBelow: 16, height: 100 });
        Object.assign(heading!.settings, { borderWidth: 1 });
        Object.assign(section.blocks[2]!.settings, {
            borderWidth: 2,
            borderColor: '#dddddd',
            background: '#fafafa',
        });
        const spacer = { uid: 'spacer01', settings: { ...image!.settings, kind: 'spacer', height: 48 } };
        section.blocks.push(spacer);
        const css = layoutCss(readDocument({ sections: [section] }));
        // A block whose uid skipped reading is left out.
        const broken = { ...section, blocks: [{ uid: '"]{', settings: { ...image!.settings } }] };
        expect(layoutCss({ sections: [broken] })).toBe('');
        expect(css).toContain(
            `.el[data-u="${heading!.uid}"]{color:#aa0000;--el-color:#aa0000;font-size:clamp(40px,5vw,64px);font-weight:700;text-align:center;--el-align:center;border:1px solid currentColor}`,
        );
        expect(css).toContain(
            `.el[data-u="${image!.uid}"]{width:80%;padding:8px;border-radius:12px;--radius:12px;margin-bottom:16px}`,
        );
        expect(css).toContain(
            `.el[data-u="${section.blocks[2]!.uid}"]{background:#fafafa;border:2px solid #dddddd}`,
        );
        expect(css).toContain('.el[data-u="spacer01"]{width:80%');
        expect(css).toContain('height:48px');
        expect(css).toContain(`@media (max-width:749px){.el[data-u="${heading!.uid}"]{font-size:32px}}`);
    });

    it("leaves out hidden sections and anything that isn't a checked value", () => {
        const hidden = { ...styled({ background: '#000000' }), hidden: true };
        expect(layoutCss({ sections: [hidden] })).toBe('');
        // Values that skipped reading (a broken caller) never reach the CSS.
        const forged = styled({});
        forged.style.design = {
            ...forged.style.design,
            background: 'red}body{display:none',
            width: '100px;x' as unknown as number,
            headingWeight: '700',
        };
        const css = layoutCss({ sections: [forged, { ...styled({ text: '#ffffff' }), uid: 'BAD"]{' }] });
        expect(css).toBe(`.section[data-u="${forged.uid}"]{--heading-weight:700}`);
    });
});

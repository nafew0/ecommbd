import type { LayoutDocument, SectionData } from './define';
import { COLUMN_TEMPLATES, type ColumnTemplate } from './elements';
import { BREAKPOINTS, effectiveStyle, type NodeStyleValues } from './node-style';
import { eachNode, type NodeData, visibleNodes } from './nodes';
import { readableOn } from './theme';

/**
 * The stylesheet for a page's Design options (roadmap phase 16) and the nodes of its free
 * sections (phase 56): each container's layout and each node's own look, per device.
 * The storefront puts it in one `<style>` allowed by its hash in the page's Content Security
 * Policy. Everything in it comes from values already checked when the layout was read: hex
 * colours, numbers within limits, fixed choices and generated IDs, so nothing else can get in.
 *
 * Sections are targeted as `.section[data-u="<uid>"]` and set custom properties the stylesheet
 * uses (`--pad-top`, `--content-width`, `--heading-size`…), so they never fight its specificity.
 */

const TABLET = `@media (max-width:${BREAKPOINTS.tablet}px)`;
const PHONE = `@media (max-width:${BREAKPOINTS.phone}px)`;
const UID = /^[a-z0-9]{4,24}$/;
const HEX = /^#[0-9a-f]{6}$/;

type Rules = { all: string[]; tablet: string[]; phone: string[] };

const px = (value: number) => `${value}px`;
const colour = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const weight = (value: unknown): value is string => typeof value === 'string' && /^[3-9]00$/.test(value);
const align = (value: unknown): value is string => value === 'start' || value === 'center' || value === 'end';

/** A heading or text size that shrinks on narrow screens when no phone size is given. */
function fluid(size: number): string {
    const smallest = Math.max(12, Math.round(size * 0.62));
    return size <= 18
        ? px(size)
        : `clamp(${smallest}px,${Math.round((size / 12.8) * 100) / 100}vw,${size}px)`;
}

function sectionRules(section: SectionData): Rules {
    const d = section.style.design;
    const rules: Rules = { all: [], tablet: [], phone: [] };
    if (colour(d.background)) rules.all.push(`--section-bg:${d.background}`, `background:${d.background}`);
    if (colour(d.text)) rules.all.push(`--section-fg:${d.text}`, `color:${d.text}`);
    if (colour(d.button)) rules.all.push(`--accent:${d.button}`, `--on-accent:${readableOn(d.button)}`);
    if (number(d.paddingTop)) rules.all.push(`--pad-top:${px(d.paddingTop)}`);
    if (number(d.paddingBottom)) rules.all.push(`--pad-bottom:${px(d.paddingBottom)}`);
    if (number(d.paddingTopPhone)) rules.phone.push(`--pad-top:${px(d.paddingTopPhone)}`);
    if (number(d.paddingBottomPhone)) rules.phone.push(`--pad-bottom:${px(d.paddingBottomPhone)}`);
    if (number(d.width)) rules.all.push(`--content-width:${px(d.width)}`);
    if (number(d.radius)) rules.all.push(`--radius:${px(d.radius)}`);
    if (number(d.borderWidth) && d.borderWidth > 0) {
        rules.all.push(
            `border:${px(d.borderWidth)} solid ${colour(d.borderColor) ? d.borderColor : 'var(--line)'}`,
        );
    }
    if (number(d.headingSize)) rules.all.push(`--heading-size:${fluid(d.headingSize)}`);
    if (number(d.headingSizePhone)) rules.phone.push(`--heading-size:${px(d.headingSizePhone)}`);
    if (weight(d.headingWeight)) rules.all.push(`--heading-weight:${d.headingWeight}`);
    if (number(d.textSize)) rules.all.push(`--text-size:${px(d.textSize)}`);
    if (number(d.shade)) rules.all.push(`--shade:${d.shade / 100}`);
    return rules;
}

/** Rules for what's inside a styled section: its headings and text take the chosen sizes, its image the shade. */
function insideRules(section: SectionData, selector: string): string[] {
    const d = section.style.design;
    const rules: string[] = [];
    if (number(d.headingSize) || number(d.headingSizePhone)) {
        rules.push(`${selector} :is(h1,h2){font-size:var(--heading-size)}`);
    }
    if (number(d.textSize)) {
        rules.push(`${selector} :is(p,li,dd,dt,summary,td,th){font-size:var(--text-size)}`);
    }
    if (number(d.shade)) {
        rules.push(`${selector} :is(.section-bg,.hero-media) img{opacity:calc(1 - var(--shade))}`);
    }
    return rules;
}

/** A node's own look on computers (its checked style values). */
function baseRules(values: NodeStyleValues): string[] {
    const rules: string[] = [];
    if (colour(values.color)) rules.push(`color:${values.color}`, `--el-color:${values.color}`);
    if (colour(values.background)) rules.push(`background:${values.background}`);
    // A large size shrinks by itself on narrow screens; a tablet or phone size replaces it there.
    if (number(values.fontSize)) {
        const size = fluid(values.fontSize);
        // Headings, prices and badges have sizes of their own: they take this one through `--el-size`.
        rules.push(`font-size:${size}`, `--el-size:${size}`);
    }
    if (weight(values.fontWeight)) rules.push(`font-weight:${values.fontWeight}`);
    if (align(values.textAlign))
        rules.push(`text-align:${values.textAlign}`, `--el-align:${values.textAlign}`);
    if (number(values.width)) {
        rules.push(`width:${values.width}%`);
        // A narrower element sits where it's aligned.
        if (values.textAlign === 'center') rules.push('margin-inline:auto');
        if (values.textAlign === 'end') rules.push('margin-inline:auto 0');
    }
    if (number(values.padding)) rules.push(`padding:${px(values.padding)}`);
    if (number(values.radius))
        rules.push(`border-radius:${px(values.radius)}`, `--radius:${px(values.radius)}`);
    if (number(values.borderWidth) && values.borderWidth > 0) {
        const line = colour(values.borderColor) ? values.borderColor : 'currentColor';
        rules.push(`border:${px(values.borderWidth)} solid ${line}`);
    }
    if (number(values.marginBottom)) rules.push(`margin-bottom:${px(values.marginBottom)}`);
    return rules;
}

/** What a narrower device changes: only the values it sets itself. */
function deviceRules(own: NodeStyleValues, effective: NodeStyleValues): string[] {
    const rules: string[] = [];
    if (colour(own.color)) rules.push(`color:${own.color}`, `--el-color:${own.color}`);
    if (colour(own.background)) rules.push(`background:${own.background}`);
    if (number(own.fontSize)) rules.push(`font-size:${px(own.fontSize)}`, `--el-size:${px(own.fontSize)}`);
    if (weight(own.fontWeight)) rules.push(`font-weight:${own.fontWeight}`);
    if (align(own.textAlign)) rules.push(`text-align:${own.textAlign}`, `--el-align:${own.textAlign}`);
    if (number(own.width)) rules.push(`width:${own.width}%`);
    if ((number(own.width) || align(own.textAlign)) && number(effective.width)) {
        const side = effective.textAlign;
        rules.push(`margin-inline:${side === 'center' ? 'auto' : side === 'end' ? 'auto 0' : '0'}`);
    }
    if (number(own.padding)) rules.push(`padding:${px(own.padding)}`);
    if (number(own.radius)) rules.push(`border-radius:${px(own.radius)}`, `--radius:${px(own.radius)}`);
    if (number(own.borderWidth) || colour(own.borderColor)) {
        const width = number(effective.borderWidth) ? effective.borderWidth : 0;
        const line = colour(effective.borderColor) ? effective.borderColor : 'currentColor';
        rules.push(width > 0 ? `border:${px(width)} solid ${line}` : 'border:0');
    }
    if (number(own.marginBottom)) rules.push(`margin-bottom:${px(own.marginBottom)}`);
    return rules;
}

const fr = (parts: readonly number[]) =>
    parts.every(part => part === parts[0])
        ? parts.length === 1
            ? 'minmax(0,1fr)'
            : `repeat(${parts.length},minmax(0,1fr))`
        : parts.map(part => `minmax(0,${part}fr)`).join(' ');

const JUSTIFY = ['center', 'end', 'space-between', 'space-around', 'space-evenly'];
const ALIGN = ['start', 'center', 'end'];

/**
 * A container's layout, from its checked props. The theme's stylesheet makes every container a
 * column with 16px between its children (`.box`); only what differs is written here.
 */
function containerRules(node: NodeData): Rules & { phoneLast: boolean } {
    const p = node.props;
    const rules = { all: [] as string[], tablet: [] as string[], phone: [] as string[], phoneLast: false };
    const gap = number(p.gap) ? p.gap : 16;
    const stack = p.stack !== false;
    if (p.mode === 'grid') {
        const template = COLUMN_TEMPLATES[p.columns as ColumnTemplate] ?? COLUMN_TEMPLATES['1-1'];
        const rowGap = number(p.rowGap) ? p.rowGap : gap;
        rules.all.push('display:grid', `gap:${px(rowGap)} ${px(gap)}`);
        if (template.length > 1) {
            rules.all.push(`grid-template-columns:${fr(template)}`);
            if (stack) {
                // Four columns are two on tablets, then one on phones.
                if (template.length > 3) rules.tablet.push(`grid-template-columns:${fr([1, 1])}`);
                rules.phone.push('grid-template-columns:minmax(0,1fr)');
            }
        }
        if (ALIGN.includes(p.align as string)) rules.all.push(`align-items:${p.align as string}`);
    } else {
        const direction = typeof p.direction === 'string' ? p.direction : 'column';
        const row = direction === 'row' || direction === 'row-reverse';
        if (direction !== 'column') rules.all.push(`flex-direction:${direction}`);
        if (row && p.wrap === true) rules.all.push('flex-wrap:wrap');
        if (gap !== 16) rules.all.push(`gap:${px(gap)}`);
        if (JUSTIFY.includes(p.justify as string)) rules.all.push(`justify-content:${p.justify as string}`);
        if (ALIGN.includes(p.align as string)) rules.all.push(`align-items:${p.align as string}`);
        if (row && stack) rules.phone.push('flex-direction:column');
    }
    rules.phoneLast = stack && p.phoneOrder === 'reverse';
    return rules;
}

function nodeRules(node: NodeData, out: Rules) {
    if (!UID.test(node.uid)) return;
    const isContainer = node.type === 'container';
    const selector = `${isContainer ? '.box' : '.el'}[data-u="${node.uid}"]`;
    const { style } = node;
    const rules: Rules = { all: [], tablet: [], phone: [] };
    if (isContainer) {
        const layout = containerRules(node);
        rules.all.push(...layout.all);
        rules.tablet.push(...layout.tablet);
        rules.phone.push(...layout.phone);
        // On phones the last column goes on top (a photo above its text).
        if (layout.phoneLast) out.phone.push(`${selector}>:last-child{order:-1}`);
    }
    rules.all.push(...baseRules(style.base));
    if (style.tablet) rules.tablet.push(...deviceRules(style.tablet, effectiveStyle(style, 'tablet')));
    if (style.phone) rules.phone.push(...deviceRules(style.phone, effectiveStyle(style, 'phone')));
    if (node.type === 'spacer' && number(node.props.height))
        rules.all.push(`height:${px(node.props.height)}`);
    write(selector, rules, out);
}

function write(selector: string, rules: Rules, out: Rules) {
    if (rules.all.length) out.all.push(`${selector}{${rules.all.join(';')}}`);
    if (rules.tablet.length) out.tablet.push(`${selector}{${rules.tablet.join(';')}}`);
    if (rules.phone.length) out.phone.push(`${selector}{${rules.phone.join(';')}}`);
}

/** The CSS for a layout's shown sections and their nodes; empty when nothing is styled. */
export function layoutCss(document: LayoutDocument): string {
    const out: Rules = { all: [], tablet: [], phone: [] };
    for (const section of document.sections) {
        if (section.hidden || !UID.test(section.uid)) continue;
        const selector = `.section[data-u="${section.uid}"]`;
        write(selector, sectionRules(section), out);
        out.all.push(...insideRules(section, selector));
        for (const { node } of eachNode(visibleNodes(section.children ?? []))) {
            if (!node.hidden) nodeRules(node, out);
        }
    }
    return (
        out.all.join('') +
        (out.tablet.length ? `${TABLET}{${out.tablet.join('')}}` : '') +
        (out.phone.length ? `${PHONE}{${out.phone.join('')}}` : '')
    );
}

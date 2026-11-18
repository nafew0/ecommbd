import type { LayoutDocument, SectionData } from './define';
import { COLUMN_TEMPLATES, type ColumnTemplate } from './elements';
import {
    BREAKPOINTS,
    effectiveStyle,
    FOCUS_POINTS,
    NODE_FONTS,
    NODE_SHADOWS,
    type NodeStyleValues,
} from './node-style';
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
/** Each screen size alone: computers, tablets (between the two widths), phones. */
const ONLY: Record<string, string> = {
    base: `@media (min-width:${BREAKPOINTS.tablet + 1}px)`,
    tablet: `@media (min-width:${BREAKPOINTS.phone + 1}px) and (max-width:${BREAKPOINTS.tablet}px)`,
    phone: PHONE,
};
const UID = /^[a-z0-9]{4,24}$/;
const HEX = /^#[0-9a-f]{6}$/;

type Rules = { all: string[]; tablet: string[]; phone: string[] };
/** A whole layout's rules, plus those for one screen size only (hiding a node there). */
type Sheet = Rules & { only: string[] };

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

/** Declarations by what they style: the node itself (''), its image, its button. */
type Look = Record<string, string[]>;

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const SELF: Record<string, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    stretch: 'stretch',
};
const TRANSFORMS = ['uppercase', 'lowercase', 'capitalize'];
const BORDERS = ['dashed', 'dotted'];
const FITS = ['cover', 'contain', 'fill', 'none', 'scale-down'];
const ASPECT = /^\d{1,2}\/\d{1,2}$/;
const has = <T extends object>(map: T, key: unknown): key is keyof T => typeof key === 'string' && key in map;

/**
 * The CSS for what one device sets (`own`), given everything that applies there (`all`). On
 * computers the two are the same. A narrower device writes only its own values, but a value that
 * is one part of a declaration (a border's colour, a gradient's second colour) needs the other
 * parts from `all`.
 */
function lookRules(own: NodeStyleValues, all: NodeStyleValues, base: boolean, inRow: boolean): Look {
    const look: Look = {};
    const add = (target: string, ...rules: string[]) => (look[target] ??= []).push(...rules);
    const set = (name: keyof NodeStyleValues) => own[name] !== undefined;

    if (colour(own.color)) add('', `color:${own.color}`, `--el-color:${own.color}`);
    if (set('background') || set('gradientTo') || set('gradientAngle')) {
        if (colour(all.background) && colour(all.gradientTo)) {
            const angle = number(all.gradientAngle) ? all.gradientAngle : 180;
            add('', `background:linear-gradient(${angle}deg,${all.background},${all.gradientTo})`);
        } else if (colour(all.background)) add('', `background:${all.background}`);
    }
    if (number(own.fontSize)) {
        // A large size shrinks by itself on narrow screens; a tablet or phone size replaces it there.
        const size = base ? fluid(own.fontSize) : px(own.fontSize);
        // Headings, prices and badges have sizes of their own: they take this one through `--el-size`.
        add('', `font-size:${size}`, `--el-size:${size}`);
    }
    if (weight(own.fontWeight)) add('', `font-weight:${own.fontWeight}`, `--el-weight:${own.fontWeight}`);
    // Headings and buttons keep a weight, line height and spacing of their own: they take these
    // through `--el-weight`, `--el-leading` and `--el-tracking`.
    if (number(own.lineHeight)) add('', `line-height:${own.lineHeight}`, `--el-leading:${own.lineHeight}`);
    if (number(own.letterSpacing)) {
        add('', `letter-spacing:${px(own.letterSpacing)}`, `--el-tracking:${px(own.letterSpacing)}`);
    }
    if (has(NODE_FONTS, own.fontFamily)) add('', `font-family:${NODE_FONTS[own.fontFamily]}`);
    if (TRANSFORMS.includes(own.textTransform as string)) add('', `text-transform:${own.textTransform}`);
    if (align(own.textAlign)) add('', `text-align:${own.textAlign}`, `--el-align:${own.textAlign}`);

    if (number(own.width)) {
        add('', `width:${own.width}%`);
        // Beside others in a row, a set width is kept instead of sharing the row evenly.
        if (inRow) add('', 'flex:none');
    }
    if (number(own.maxWidth)) add('', `max-width:${px(own.maxWidth)}`);
    // Something narrower than its place sits where it's aligned.
    const narrow = number(all.width) || number(all.maxWidth);
    if (narrow && !inRow && (set('width') || set('maxWidth') || set('textAlign'))) {
        if (all.textAlign === 'center') add('', 'margin-inline:auto');
        else if (all.textAlign === 'end') add('', 'margin-inline:auto 0');
        else if (!base) add('', 'margin-inline:0');
    }
    if (has(SELF, own.alignSelf)) add('', `align-self:${SELF[own.alignSelf]}`);
    if (number(own.flexGrow)) add('', `flex-grow:${own.flexGrow}`);
    if (number(own.minHeight)) add('', `min-height:${px(own.minHeight)}`);

    if (number(own.padding)) add('', `padding:${px(own.padding)}`);
    for (const side of SIDES) {
        const value = (number(own.padding) ? all : own)[`padding${side}`];
        if (number(value)) add('', `padding-${side.toLowerCase()}:${px(value)}`);
    }
    for (const side of SIDES) {
        const value = own[`margin${side}`];
        if (number(value)) add('', `margin-${side.toLowerCase()}:${px(value)}`);
    }

    if (number(own.radius)) add('', `border-radius:${px(own.radius)}`, `--radius:${px(own.radius)}`);
    if (set('borderWidth') || set('borderStyle') || set('borderColor')) {
        const width = number(all.borderWidth) ? all.borderWidth : 0;
        const style = BORDERS.includes(all.borderStyle as string) ? all.borderStyle : 'solid';
        const line = colour(all.borderColor) ? all.borderColor : 'currentColor';
        if (width > 0) add('', `border:${px(width)} ${style} ${line}`);
        else if (!base) add('', 'border:0');
    }
    if (has(NODE_SHADOWS, own.shadow)) add('', `box-shadow:${NODE_SHADOWS[own.shadow]}`);
    if (number(own.opacity)) add('', `opacity:${own.opacity / 100}`);

    if (typeof own.aspect === 'string' && ASPECT.test(own.aspect)) {
        add(' img', `aspect-ratio:${own.aspect}`);
        // A frame of another shape is filled, unless the merchant chose otherwise.
        if (!FITS.includes(all.objectFit as string)) add(' img', 'object-fit:cover');
    }
    if (FITS.includes(own.objectFit as string)) add(' img', `object-fit:${own.objectFit}`);
    if (has(FOCUS_POINTS, own.objectPosition))
        add(' img', `object-position:${FOCUS_POINTS[own.objectPosition]}`);

    // A button's colour is its border's too, unless the border has its own.
    if (colour(own.buttonBg)) add(' .button', `background:${own.buttonBg}`, `border-color:${own.buttonBg}`);
    if (colour(own.buttonText)) add(' .button', `color:${own.buttonText}`);
    if (set('buttonBorder') || set('buttonBg')) {
        if (colour(all.buttonBorder)) add(' .button', `border-color:${all.buttonBorder}`);
    }
    if (set('buttonPaddingX') || set('buttonPaddingY')) {
        const x = number(all.buttonPaddingX) ? all.buttonPaddingX : 24;
        const y = number(all.buttonPaddingY) ? all.buttonPaddingY : 0;
        add(' .button', `padding:${px(y)} ${px(x)}`);
    }
    if (colour(own.buttonHoverBg)) {
        add(
            ' .button:hover',
            `background:${own.buttonHoverBg}`,
            `border-color:${own.buttonHoverBg}`,
            'opacity:1',
        );
    }
    if (colour(own.buttonHoverText)) add(' .button:hover', `color:${own.buttonHoverText}`);
    return look;
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

function nodeRules(node: NodeData, parent: NodeData | null, out: Sheet) {
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
        // The shade over a container's background image.
        if (node.props.image && number(node.props.shade))
            rules.all.push(`--box-shade:${node.props.shade / 100}`);
    }
    if (node.type === 'spacer' && number(node.props.height))
        rules.all.push(`height:${px(node.props.height)}`);
    const inRow =
        parent?.props.mode !== 'grid' &&
        (parent?.props.direction === 'row' || parent?.props.direction === 'row-reverse');
    const looks = {
        all: lookRules(style.base, style.base, true, inRow),
        tablet: style.tablet ? lookRules(style.tablet, effectiveStyle(style, 'tablet'), false, inRow) : {},
        phone: style.phone ? lookRules(style.phone, effectiveStyle(style, 'phone'), false, inRow) : {},
    };
    for (const device of ['all', 'tablet', 'phone'] as const) {
        rules[device].push(...(looks[device][''] ?? []));
    }
    write(selector, rules, out);
    // Hidden on a screen size: on that size only, not on the narrower ones too.
    for (const device of node.hideOn ?? []) {
        if (device in ONLY) out.only.push(`${ONLY[device]}{${selector}{display:none}}`);
    }
    // What's inside the node: its image, its button.
    for (const device of ['all', 'tablet', 'phone'] as const) {
        for (const [target, declarations] of Object.entries(looks[device])) {
            if (target) out[device].push(`${selector}${target}{${declarations.join(';')}}`);
        }
    }
}

function write(selector: string, rules: Rules, out: Rules) {
    if (rules.all.length) out.all.push(`${selector}{${rules.all.join(';')}}`);
    if (rules.tablet.length) out.tablet.push(`${selector}{${rules.tablet.join(';')}}`);
    if (rules.phone.length) out.phone.push(`${selector}{${rules.phone.join(';')}}`);
}

/** The CSS for a layout's shown sections and their nodes; empty when nothing is styled. */
export function layoutCss(document: LayoutDocument): string {
    const out: Sheet = { all: [], tablet: [], phone: [], only: [] };
    for (const section of document.sections) {
        if (section.hidden || !UID.test(section.uid)) continue;
        const selector = `.section[data-u="${section.uid}"]`;
        write(selector, sectionRules(section), out);
        out.all.push(...insideRules(section, selector));
        for (const { node, parent } of eachNode(visibleNodes(section.children ?? []))) {
            if (!node.hidden) nodeRules(node, parent, out);
        }
    }
    return (
        out.all.join('') +
        (out.tablet.length ? `${TABLET}{${out.tablet.join('')}}` : '') +
        (out.phone.length ? `${PHONE}{${out.phone.join('')}}` : '') +
        out.only.join('')
    );
}

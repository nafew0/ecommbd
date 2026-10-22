import type { LayoutDocument, SectionData } from './define';
import { readableOn } from './theme';

/**
 * The stylesheet for a page's Design options and Custom section elements (roadmap phase 16).
 * The storefront puts it in one `<style>` allowed by its hash in the page's Content Security
 * Policy. Everything in it comes from values already checked when the layout was read: hex
 * colours, numbers within limits, fixed choices and generated IDs, so nothing else can get in.
 *
 * Sections are targeted as `.section[data-u="<uid>"]` and set custom properties the stylesheet
 * uses (`--pad-top`, `--content-width`, `--heading-size`…), so they never fight its specificity.
 */

const PHONE = '@media (max-width:749px)';
const UID = /^[a-z0-9]{4,24}$/;
const HEX = /^#[0-9a-f]{6}$/;

type Rules = { all: string[]; phone: string[] };

const px = (value: number) => `${value}px`;
const colour = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const weight = (value: unknown): value is string => typeof value === 'string' && /^[4-8]00$/.test(value);

/** A heading or text size that shrinks on narrow screens when no phone size is given. */
function fluid(size: number): string {
    const smallest = Math.max(12, Math.round(size * 0.62));
    return size <= 18
        ? px(size)
        : `clamp(${smallest}px,${Math.round((size / 12.8) * 100) / 100}vw,${size}px)`;
}

function sectionRules(section: SectionData): Rules {
    const d = section.style.design;
    const rules: Rules = { all: [], phone: [] };
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

/** An element of a Custom section, by its stored settings (already checked). */
function elementRules(settings: Record<string, unknown>): Rules {
    const rules: Rules = { all: [], phone: [] };
    if (colour(settings.color)) rules.all.push(`color:${settings.color}`, `--el-color:${settings.color}`);
    if (colour(settings.background)) rules.all.push(`background:${settings.background}`);
    if (number(settings.size)) rules.all.push(`font-size:${fluid(settings.size)}`);
    if (number(settings.sizePhone)) rules.phone.push(`font-size:${px(settings.sizePhone)}`);
    if (weight(settings.weight)) rules.all.push(`font-weight:${settings.weight}`);
    if (settings.align === 'start' || settings.align === 'center' || settings.align === 'end') {
        rules.all.push(`text-align:${settings.align}`, `--el-align:${settings.align}`);
    }
    if (number(settings.width)) {
        rules.all.push(`width:${settings.width}%`);
        // A narrower element sits where it's aligned.
        if (settings.align === 'center') rules.all.push('margin-inline:auto');
        if (settings.align === 'end') rules.all.push('margin-inline:auto 0');
    }
    if (number(settings.padding)) rules.all.push(`padding:${px(settings.padding)}`);
    if (number(settings.radius))
        rules.all.push(`border-radius:${px(settings.radius)}`, `--radius:${px(settings.radius)}`);
    if (number(settings.borderWidth) && settings.borderWidth > 0) {
        const line = colour(settings.borderColor) ? settings.borderColor : 'currentColor';
        rules.all.push(`border:${px(settings.borderWidth)} solid ${line}`);
    }
    if (number(settings.spaceBelow)) rules.all.push(`margin-bottom:${px(settings.spaceBelow)}`);
    // Every element holds every field (with defaults); only a space uses its height.
    if (settings.kind === 'spacer' && number(settings.height))
        rules.all.push(`height:${px(settings.height)}`);
    return rules;
}

function write(selector: string, rules: Rules, out: Rules) {
    if (rules.all.length) out.all.push(`${selector}{${rules.all.join(';')}}`);
    if (rules.phone.length) out.phone.push(`${selector}{${rules.phone.join(';')}}`);
}

/** The CSS for a layout's shown sections; empty when nothing is styled. */
export function layoutCss(document: LayoutDocument): string {
    const out: Rules = { all: [], phone: [] };
    for (const section of document.sections) {
        if (section.hidden || !UID.test(section.uid)) continue;
        const selector = `.section[data-u="${section.uid}"]`;
        write(selector, sectionRules(section), out);
        out.all.push(...insideRules(section, selector));
        if (section.type !== 'custom') continue;
        const gap = (section.settings as { gap?: unknown }).gap;
        if (number(gap)) out.all.push(`${selector} .custom{column-gap:${px(gap)}}`);
        for (const block of section.blocks) {
            if (!UID.test(block.uid)) continue;
            write(`.el[data-u="${block.uid}"]`, elementRules(block.settings as Record<string, unknown>), out);
        }
    }
    return out.all.join('') + (out.phone.length ? `${PHONE}{${out.phone.join('')}}` : '');
}

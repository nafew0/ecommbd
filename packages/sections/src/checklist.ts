import type { LayoutDocument, SectionData } from './define';
import { documentIssues, shownSmartSections } from './document';
import { elementDefinition } from './elements';
import { effectiveStyle } from './node-style';
import { eachNode, type NodeData } from './nodes';
import { type Bilingual, isRecord } from './text';
import { contrastRatio } from './theme';

/**
 * The pre-publish checklist (roadmap phase 62): what a merchant should look at before a page
 * goes live. **Blockers** stop publishing (a broken link, too many elements, a page that would
 * be too heavy). **Warnings** are things shoppers will notice (a heading with no words, a button
 * that goes nowhere, text that's hard to read). **Tips** make a good page better (a description
 * for a photo). Two more checks need the page drawn at phone width, so the editor asks the
 * preview frame for them: sideways scrolling and buttons too small to tap.
 */

export type CheckLevel = 'blocker' | 'warning' | 'tip';

export type CheckCode =
    // What `documentIssues` refuses.
    | 'invalidUrl'
    | 'invalidAnchor'
    | 'invalidVideo'
    | 'duplicateAnchor'
    | 'tooManySections'
    | 'duplicateOrderForm'
    | 'tooDeep'
    | 'tooManyNodes'
    | 'budget'
    // Content.
    | 'emptySection'
    | 'emptyText'
    | 'sampleText'
    | 'missingImage'
    | 'buttonNoLink'
    | 'noDeadline'
    // Accessibility.
    | 'missingAlt'
    | 'lowContrast'
    | 'manyH1'
    | 'banglaFont'
    | 'hiddenEverywhere'
    // Measured on the page, at phone width.
    | 'overflow'
    | 'smallTap';

export interface CheckItem {
    code: CheckCode;
    level: CheckLevel;
    sectionId: string;
    /** The node (or block) it's about, inside the section. */
    nodeId?: string;
}

/** First-party script each kind of page starts with, and what interactive parts add (KB, gzipped). */
export const SCRIPT_COSTS = {
    /** The storefront's own script on every page: the cart, search, attribution. */
    base: 3.0,
    slideshow: 0.9,
    video: 0.7,
    countdown: 0.7,
    'order-form': 1.7,
} as const;

/** The budgets of architecture.md, Decision 2: product and content pages, and sales pages. */
export const SCRIPT_BUDGET_KB = { page: 30, landing: 45 } as const;

/** Roughly how much first-party script a page's sections and elements load, in KB gzipped. */
export function estimateScriptKb(document: LayoutDocument): number {
    const kinds = new Set<string>();
    for (const section of shownSmartSections(document)) {
        if (section.type in SCRIPT_COSTS) kinds.add(section.type);
        if (section.type === 'sales-hero' && section.settings.media === 'video') kinds.add('video');
    }
    for (const section of document.sections) {
        if (section.hidden) continue;
        for (const { node } of eachNode(section.children ?? [])) {
            if (!node.hidden && node.type in SCRIPT_COSTS) kinds.add(node.type);
        }
    }
    let total: number = SCRIPT_COSTS.base;
    for (const kind of kinds) total += SCRIPT_COSTS[kind as keyof typeof SCRIPT_COSTS];
    return Math.round(total * 10) / 10;
}

const filled = (value: unknown): boolean =>
    isRecord(value) && (!!String(value.bn ?? '').trim() || !!String(value.en ?? '').trim());

const plain = (value: unknown): Bilingual => {
    const strip = (text: unknown) =>
        String(text ?? '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    return isRecord(value) ? { bn: strip(value.bn), en: strip(value.en) } : { bn: '', en: '' };
};

/** The words an element is added with: left as they are, they're sample content. */
function isSample(node: NodeData, name: string): boolean {
    const preset = elementDefinition(node.type)?.preset?.[name];
    if (!preset || !filled(preset)) return false;
    const now = plain(node.props[name]);
    const start = plain(preset);
    return now.bn === start.bn && now.en === start.en;
}

const BANGLA = /[ঀ-৿]/;
const TEXT_PROPS = ['text', 'label', 'items', 'heading', 'body'];

function nodeChecks(section: SectionData, items: CheckItem[]) {
    const add = (code: CheckCode, level: CheckLevel, node: NodeData) =>
        items.push({ code, level, sectionId: section.uid, nodeId: node.uid });
    /** The colour or background that applies to a node: its own, else the nearest container's. */
    const inherited = (chain: NodeData[], name: 'color' | 'background', fallback: string) =>
        [...chain]
            .reverse()
            .map(item => item.style.base[name])
            .find(Boolean) ?? fallback;

    const walk = (nodes: readonly NodeData[], chain: NodeData[]) => {
        for (const node of nodes) {
            if (node.hidden) continue;
            const here = [...chain, node];
            const p = node.props;
            if (node.hideOn?.length === 3) add('hiddenEverywhere', 'tip', node);
            if (
                node.type === 'heading' ||
                node.type === 'text' ||
                node.type === 'badge' ||
                node.type === 'quote'
            ) {
                const name = node.type === 'badge' ? 'label' : 'text';
                if (!filled(plain(p[name]))) add('emptyText', 'warning', node);
                else if (isSample(node, name)) add('sampleText', 'warning', node);
            }
            if (node.type === 'button') {
                if (!filled(p.label)) add('emptyText', 'warning', node);
                else if (isRecord(p.link) && p.link.type === 'none') add('buttonNoLink', 'warning', node);
            }
            if (node.type === 'image') {
                if (!p.image) add('missingImage', 'warning', node);
                else if (!filled(p.alt)) add('missingAlt', 'tip', node);
            }
            if (node.type === 'countdown' && !p.endsAt) add('noDeadline', 'warning', node);
            if (node.type === 'video' && !p.video) add('emptyText', 'warning', node);
            // A serif or typewriter face has no Bangla letters: they show in another font.
            const family = node.style.base.fontFamily;
            if (
                (family === 'serif' || family === 'mono') &&
                TEXT_PROPS.some(name => BANGLA.test(plain(p[name]).bn))
            ) {
                add('banglaFont', 'tip', node);
            }
            // Text against the background behind it, where both are set.
            if (node.type !== 'container' && node.type !== 'live' && node.type !== 'image') {
                const ink = inherited(here, 'color', section.style.design.text);
                const paper = inherited(here, 'background', section.style.design.background);
                for (const device of ['base', 'tablet', 'phone'] as const) {
                    const own = effectiveStyle(node.style, device);
                    const text = own.color ?? ink;
                    const behind = own.background ?? paper;
                    if (text && behind && contrastRatio(text, behind) < 4.5) {
                        add('lowContrast', 'warning', node);
                        break;
                    }
                }
            }
            if (node.children) walk(node.children, here);
        }
    };
    walk(section.children ?? [], []);
}

export interface ChecklistOptions {
    /** `landing` for a sales page (the larger script budget). */
    layoutType?: string;
}

/** Everything the checklist can tell from the page's data, most serious first. */
export function pageChecklist(document: LayoutDocument, options: ChecklistOptions = {}): CheckItem[] {
    const items: CheckItem[] = documentIssues(document).map(issue => ({
        code: issue.code,
        level: 'blocker',
        sectionId: issue.sectionId,
        nodeId: issue.blockId,
    }));
    const budget = options.layoutType === 'landing' ? SCRIPT_BUDGET_KB.landing : SCRIPT_BUDGET_KB.page;
    const first = document.sections.find(section => !section.hidden);
    if (first && estimateScriptKb(document) > budget) {
        items.push({ code: 'budget', level: 'blocker', sectionId: first.uid });
    }
    const pageTitles: Array<{ section: SectionData; node: NodeData }> = [];
    for (const section of document.sections) {
        if (section.hidden) continue;
        if (section.children) {
            if (
                ![...eachNode(section.children)].some(({ node }) => !node.hidden && node.type !== 'container')
            ) {
                items.push({ code: 'emptySection', level: 'warning', sectionId: section.uid });
            }
            nodeChecks(section, items);
            for (const { node } of eachNode(section.children)) {
                if (!node.hidden && node.type === 'heading' && node.props.tag === 'h1')
                    pageTitles.push({ section, node });
            }
        }
    }
    // One page title: search engines and screen readers take the H1 as what the page is about.
    for (const extra of pageTitles.slice(1)) {
        items.push({
            code: 'manyH1',
            level: 'warning',
            sectionId: extra.section.uid,
            nodeId: extra.node.uid,
        });
    }
    const order: Record<CheckLevel, number> = { blocker: 0, warning: 1, tip: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
}

/** True when nothing stops the page from being published. */
export function canPublish(items: readonly CheckItem[]): boolean {
    return !items.some(item => item.level === 'blocker');
}

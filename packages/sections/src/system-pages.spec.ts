import { describe, expect, it } from 'vitest';
import { canPublish, pageChecklist } from './checklist';
import { SYSTEM_LAYOUTS } from './define';
import { createSection, readDocument } from './document';
import { sectionsFor } from './registry';
import {
    defaultSystemLayout,
    hasPageContent,
    isSystemLayout,
    needsPageContent,
    PAGE_CONTENT,
    splitAtContent,
    SYSTEM_PAGES,
    withPageContent,
} from './system-pages';

describe('system pages (phase 60)', () => {
    it('names every system page and its block in Bangla and English', () => {
        for (const type of SYSTEM_LAYOUTS) {
            const page = SYSTEM_PAGES[type];
            for (const text of [page.name, page.description, page.block, page.blockHint]) {
                expect(text.en.trim()).not.toBe('');
                expect(text.bn).toMatch(/[ঀ-৿]/);
            }
        }
        expect(isSystemLayout('checkout')).toBe(true);
        expect(isSystemLayout('home')).toBe(false);
    });

    it('offers the page’s own part only on system pages', () => {
        const types = (layout: Parameters<typeof sectionsFor>[0]) =>
            sectionsFor(layout).map(definition => definition.type);
        expect(types('home')).not.toContain(PAGE_CONTENT);
        expect(types('page')).not.toContain(PAGE_CONTENT);
        expect(types('landing')).not.toContain(PAGE_CONTENT);
        for (const type of SYSTEM_LAYOUTS) expect(types(type)).toContain(PAGE_CONTENT);
        // The sales page's order form stays on sales pages: a checkout never gets a second form.
        expect(types('checkout')).not.toContain('order-form');
    });

    it('starts as its own part, and survives being stored and read', () => {
        const start = defaultSystemLayout();
        expect(start.sections.map(section => section.type)).toEqual([PAGE_CONTENT]);
        expect(readDocument(JSON.parse(JSON.stringify(start)))).toEqual(start);
        expect(hasPageContent(start)).toBe(true);
    });

    it('splits the sections around the page’s own part', () => {
        const above = createSection('rich-text');
        const below = createSection('faq');
        const hidden = { ...createSection('banner'), hidden: true };
        const content = createSection(PAGE_CONTENT);
        const second = createSection(PAGE_CONTENT);
        const split = splitAtContent({ sections: [above, hidden, content, below, second] });
        expect(split.before).toEqual([above]);
        expect(split.content).toBe(content);
        // A second block never shows the part twice.
        expect(split.after).toEqual([below]);
    });

    it('puts everything below when there is no block (a product template from before phase 60)', () => {
        const old = { sections: [createSection('trust-badges')] };
        expect(splitAtContent(old)).toEqual({ before: [], content: null, after: old.sections });
        const upgraded = withPageContent(old);
        expect(upgraded.sections.map(section => section.type)).toEqual([PAGE_CONTENT, 'trust-badges']);
        expect(withPageContent(upgraded)).toBe(upgraded);
        // A hidden block counts as gone.
        const hiddenBlock = { sections: [{ ...createSection(PAGE_CONTENT), hidden: true }] };
        expect(splitAtContent(hiddenBlock).content).toBeNull();
        expect(hasPageContent(hiddenBlock)).toBe(false);
    });

    it('blocks publishing a page that lost its own part, except the header and footer', () => {
        const none = { sections: [createSection('rich-text')] };
        for (const type of SYSTEM_LAYOUTS) {
            const items = pageChecklist(none, { layoutType: type });
            const blocked = items.some(item => item.code === 'missingContent');
            expect(blocked).toBe(needsPageContent(type));
            if (blocked) expect(canPublish(items)).toBe(false);
        }
        expect(needsPageContent('header')).toBe(false);
        expect(needsPageContent('footer')).toBe(false);
        expect(needsPageContent('home')).toBe(false);
        const withBlock = pageChecklist(defaultSystemLayout(), { layoutType: 'checkout' });
        expect(withBlock.some(item => item.code === 'missingContent')).toBe(false);
        // An empty page still says so.
        expect(pageChecklist({ sections: [] }, { layoutType: 'cart' }).map(item => item.code)).toContain(
            'missingContent',
        );
    });
});

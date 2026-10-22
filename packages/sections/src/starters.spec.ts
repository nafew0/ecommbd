import { describe, expect, it } from 'vitest';
import { documentIssues, documentRefs, LAYOUT_LIMITS, readDocument } from './document';
import { defaultHomeLayout, defaultProductTemplate, STARTER_INFO, starterLayout, STARTERS } from './starters';

describe('starter layouts', () => {
    it.each(STARTERS)('%s is ready to publish and fills itself', name => {
        const layout = starterLayout(name);
        expect(STARTER_INFO[name].name.bn).toBeTruthy();
        expect(layout.sections.length).toBeGreaterThanOrEqual(6);
        expect(layout.sections.length).toBeLessThanOrEqual(LAYOUT_LIMITS.warnAbove);
        expect(documentIssues(layout)).toEqual([]);
        // Nothing picked by hand: the store's own products and categories fill it.
        expect(documentRefs(layout, { includeHidden: true })).toEqual({
            products: [],
            collections: [],
            pages: [],
            assets: [],
        });
        // Stable when stored and read back.
        expect(readDocument(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    });

    it('gives new section IDs every time', () => {
        const first = starterLayout('food').sections.map(section => section.uid);
        const second = starterLayout('food').sections.map(section => section.uid);
        expect(first).not.toEqual(second);
    });

    it('starts hidden sections that need the merchant’s own content', () => {
        const hidden = starterLayout('gadgets').sections.filter(section => section.hidden);
        expect(hidden.map(section => section.type)).toEqual(['video']);
    });

    it('builds the default home page from the store’s name and description', () => {
        const layout = defaultHomeLayout({
            name: { bn: 'রঙিন বাজার', en: 'Rongin Bazar' },
            description: { bn: 'হাতে বোনা শাড়ি', en: '' },
        });
        expect(layout.sections.map(section => section.type)).toEqual([
            'hero',
            'collection-list',
            'product-grid',
            'trust-badges',
        ]);
        expect(layout.sections[0]!.settings).toMatchObject({
            heading: { bn: 'রঙিন বাজার', en: 'Rongin Bazar' },
            text: { bn: 'হাতে বোনা শাড়ি', en: '' },
            badge: { bn: '', en: '' },
        });
        expect(defaultProductTemplate()).toEqual({ sections: [] });
    });
});

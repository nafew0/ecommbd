import { describe, expect, it } from 'vitest';
import { layoutCss } from './css';
import { documentIssues, documentRefs, LAYOUT_LIMITS, readDocument } from './document';
import {
    PAGE_DESIGNS,
    pageDesign,
    READY_CATEGORIES,
    READY_CATEGORY_NAMES,
    READY_SECTIONS,
    readySection,
    readySectionsFor,
    STORE_DESIGNS,
    STORE_TYPE_NAMES,
    STORE_TYPES,
    storeDesign,
} from './library';
import { eachNode, NODE_LIMITS, nodeDepth } from './nodes';

const store = { name: 'Rahim Fashion', description: 'Panjabi and more, cash on delivery' };
const bangla = /[ঀ-৿]/;

describe('ready sections (phase 59)', () => {
    it('has at least sixty, each named and described in Bangla and English', () => {
        expect(READY_SECTIONS.length).toBeGreaterThanOrEqual(60);
        const ids = READY_SECTIONS.map(item => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of READY_SECTIONS) {
            expect(item.name.bn).toMatch(bangla);
            expect(item.name.en).toBeTruthy();
            expect(item.description.bn).toMatch(bangla);
            expect(item.description.en).toBeTruthy();
            expect(READY_CATEGORIES).toContain(item.category);
        }
        for (const type of STORE_TYPES)
            expect(STORE_TYPE_NAMES[type].bn && STORE_TYPE_NAMES[type].en).toBeTruthy();
        for (const category of READY_CATEGORIES) expect(READY_CATEGORY_NAMES[category].bn).toMatch(bangla);
    });

    it('builds each one ready to publish, new every time, with nothing picked by hand', () => {
        for (const item of READY_SECTIONS) {
            const section = item.build();
            const document = { sections: [section] };
            expect(documentIssues(document), item.id).toEqual([]);
            expect(readDocument(JSON.parse(JSON.stringify(document))), item.id).toEqual(document);
            expect(item.build().uid).not.toBe(section.uid);
            // The store's own products, categories and photos fill it.
            expect(documentRefs(document, { includeHidden: true })).toEqual({
                products: [],
                collections: [],
                pages: [],
                assets: [],
            });
            expect(nodeDepth(section.children ?? [])).toBeLessThanOrEqual(NODE_LIMITS.depth);
        }
    });

    it('keeps to the design standard: no gradients, corners barely rounded', () => {
        for (const item of READY_SECTIONS) {
            const section = item.build();
            expect(layoutCss({ sections: [section] }), item.id).not.toContain('gradient');
            for (const { node } of eachNode(section.children ?? [])) {
                expect(node.style.base.gradientTo).toBeUndefined();
                expect(node.style.base.radius ?? 0).toBeLessThanOrEqual(4);
                expect(node.style.base.shadow).toBeUndefined();
            }
        }
    });

    it('filters by the kind of store and by category', () => {
        for (const type of STORE_TYPES) {
            const own = READY_SECTIONS.filter(
                item => item.storeTypes !== 'all' && item.storeTypes.includes(type),
            );
            expect(own.length).toBeGreaterThanOrEqual(5);
            // A store type sees its own sections and the ones for any store.
            expect(readySectionsFor(type, 'all').length).toBeGreaterThan(own.length + 25);
        }
        expect(readySectionsFor('all', 'all')).toHaveLength(READY_SECTIONS.length);
        for (const category of READY_CATEGORIES) {
            const found = readySectionsFor('fashion', category);
            expect(found.length).toBeGreaterThan(0);
            expect(found.every(item => item.category === category)).toBe(true);
        }
        expect(readySectionsFor('grocery', 'all').some(item => item.id === 'fashion-welcome')).toBe(false);
        expect(readySectionsFor('grocery', 'media').some(item => item.id === 'lookbook-portrait')).toBe(
            false,
        );
        expect(readySection('food-faq')!.build().blocks).toHaveLength(3);
        expect(readySection('missing')).toBeUndefined();
    });
});

describe('store designs', () => {
    it('has at least eleven home pages: one or more for each kind of store, and one for any', () => {
        expect(STORE_DESIGNS.length).toBeGreaterThanOrEqual(11);
        const ids = STORE_DESIGNS.map(item => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const type of STORE_TYPES.filter(item => item !== 'general')) {
            expect(STORE_DESIGNS.some(item => item.storeType === type)).toBe(true);
        }
        expect(STORE_DESIGNS.filter(item => item.storeType === 'any')).toHaveLength(1);
    });

    it('builds each one ready to publish, within the page’s limits, with the store’s own words', () => {
        for (const design of STORE_DESIGNS) {
            expect(design.name.bn).toMatch(bangla);
            expect(design.description.bn).toMatch(bangla);
            const document = design.build(store);
            expect(document.sections.length).toBeGreaterThanOrEqual(6);
            expect(document.sections.length).toBeLessThanOrEqual(LAYOUT_LIMITS.warnAbove);
            expect(documentIssues(document), design.id).toEqual([]);
            expect(readDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
            const ids = document.sections.map(section => section.uid);
            expect(new Set(ids).size).toBe(ids.length);
            // The store's short description is the welcome's text.
            expect(document.sections[0]).toMatchObject({
                type: 'hero',
                settings: { text: { en: store.description } },
            });
        }
        // Without a description the design's own words stay.
        const plain = storeDesign('food-home')!.build({ name: 'X', description: '' });
        expect(plain.sections[0]!.settings.text).toMatchObject({ en: expect.stringContaining('Ghee') });
        expect(storeDesign('missing')).toBeUndefined();
    });
});

describe('page designs', () => {
    it('has the pages every store needs, each ready to publish', () => {
        expect(PAGE_DESIGNS.map(item => item.id)).toEqual([
            'about',
            'contact',
            'faq',
            'privacy',
            'terms',
            'shipping',
            'returns',
            'size-guide',
        ]);
        for (const design of PAGE_DESIGNS) {
            expect(design.name.bn).toMatch(bangla);
            const document = design.build(store);
            expect(document.sections.length).toBeGreaterThan(0);
            expect(documentIssues(document), design.id).toEqual([]);
            expect(readDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
        }
        // Policies name the store.
        const privacy = pageDesign('privacy')!.build(store).sections[0]!;
        expect(privacy.settings.text).toMatchObject({
            bn: expect.stringContaining('Rahim Fashion'),
            en: expect.stringContaining('Rahim Fashion'),
        });
    });
});

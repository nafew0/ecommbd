import { describe, expect, it } from 'vitest';
import { defineSection } from './define';
import {
    copySection,
    createBlock,
    createSection,
    documentIssues,
    documentRefs,
    eachField,
    LAYOUT_LIMITS,
    mapDocumentIds,
    mapLinks,
    migrateSection,
    newId,
    readDocument,
    readSection,
} from './document';
import { field } from './fields';
import { SECTIONS, sectionDefinition, sectionsFor } from './registry';
import { DEFAULT_STYLE, readStyle } from './style';

describe('the section library', () => {
    it('has about twenty sections with names, descriptions and fields in both languages', () => {
        expect(SECTIONS.length).toBeGreaterThanOrEqual(18);
        const types = new Set(SECTIONS.map(definition => definition.type));
        expect(types.size).toBe(SECTIONS.length);
        for (const definition of SECTIONS) {
            expect(definition.name.bn && definition.name.en, definition.type).toBeTruthy();
            expect(definition.description.bn && definition.description.en, definition.type).toBeTruthy();
            for (const [name, item] of Object.entries({
                ...definition.fields,
                ...definition.blocks?.fields,
            })) {
                expect(item.label.bn && item.label.en, `${definition.type}.${name}`).toBeTruthy();
                if (item.kind === 'select') {
                    expect(item.options.some(option => option.value === item.default)).toBe(true);
                }
            }
            if (definition.blocks?.titleField) {
                expect(definition.blocks.fields).toHaveProperty(definition.blocks.titleField);
            }
        }
        expect(sectionsFor('home')).toHaveLength(SECTIONS.length);
        expect(sectionDefinition('nope')).toBeUndefined();
    });

    it('creates every section ready to publish, with its preset', () => {
        for (const definition of SECTIONS) {
            const section = createSection(definition.type);
            expect(section.v).toBe(definition.version);
            expect(documentIssues({ sections: [section] }), definition.type).toEqual([]);
            expect(readSection(section), definition.type).toEqual(section);
            if (definition.blocks?.min)
                expect(section.blocks.length).toBeGreaterThanOrEqual(definition.blocks.min);
        }
        expect(createSection('faq').blocks[0]!.settings).toMatchObject({
            question: { bn: 'কীভাবে অর্ডার করব?' },
        });
        expect(() => createSection('nope')).toThrow('Unknown section type');
    });

    it('makes new blocks with default values', () => {
        const block = createBlock('faq');
        expect(block.settings).toEqual({ question: { bn: '', en: '' }, answer: { bn: '', en: '' } });
        expect(createBlock('nope').settings).toEqual({});
    });
});

describe('reading stored layouts', () => {
    it('drops unknown types and fields, and fills missing values with defaults', () => {
        const document = readDocument({
            sections: [
                {
                    uid: 'abcd1234',
                    type: 'rich-text',
                    v: 1,
                    settings: { heading: { bn: 'শিরোনাম', en: '' }, script: '<b>' },
                },
                { uid: 'efgh5678', type: 'custom-html', settings: { html: '<script>' } },
                'garbage',
            ],
        });
        expect(document.sections).toHaveLength(1);
        const [section] = document.sections;
        expect(section!.settings).toEqual({
            heading: { bn: 'শিরোনাম', en: '' },
            text: {
                bn: '<p>আপনার দোকান সম্পর্কে কয়েকটি কথা লিখুন।</p>',
                en: '<p>Write a few words about your store.</p>',
            },
            button: { bn: '', en: '' },
            link: { type: 'none' },
        });
        expect(section!.style).toEqual({ ...DEFAULT_STYLE, width: 'narrow', align: 'center' });
        expect(section!.hidden).toBe(false);
    });

    it('accepts a bare list, and anything else as empty', () => {
        expect(readDocument([{ type: 'divider' }]).sections).toHaveLength(1);
        expect(readDocument(null).sections).toEqual([]);
        expect(readDocument({ sections: 'x' }).sections).toEqual([]);
    });

    it('gives new IDs to damaged or repeated ones', () => {
        const document = readDocument({
            sections: [
                { uid: 'same0001', type: 'divider' },
                { uid: 'same0001', type: 'divider' },
                { uid: '<bad>', type: 'divider' },
                {
                    id: 'faq00001',
                    type: 'faq',
                    blocks: [
                        { uid: 'blk00001' },
                        { uid: 'blk00001' },
                        'junk',
                        { settings: { question: 'Why?' } },
                    ],
                },
            ],
        });
        const ids = document.sections.map(section => section.uid);
        expect(new Set(ids).size).toBe(4);
        expect(ids[0]).toBe('same0001');
        expect(ids[2]).toMatch(/^[a-z0-9]{8}$/);
        const blocks = document.sections[3]!.blocks;
        expect(blocks).toHaveLength(3);
        expect(new Set(blocks.map(block => block.uid)).size).toBe(3);
        expect(blocks[2]!.settings).toMatchObject({ question: { bn: 'Why?', en: 'Why?' } });
    });

    it('caps blocks at the maximum and keeps hidden sections hidden', () => {
        const section = readSection({
            type: 'slideshow',
            hidden: true,
            blocks: Array.from({ length: 9 }, () => ({ settings: {} })),
            settings: 'not an object',
        })!;
        expect(section.blocks).toHaveLength(5);
        expect(section.hidden).toBe(true);
        expect(section.settings).toMatchObject({ height: 'm', autoplay: false });
        expect(readSection({ type: 'divider', blocks: [{}] })!.blocks).toEqual([]);
        expect(readSection({ type: 5 })).toBeNull();
    });

    it('sanitizes rich text when asked', () => {
        const section = readSection(
            { type: 'rich-text', settings: { text: { bn: '<p>ক</p><script>x</script>', en: '' } } },
            { sanitize: html => html.replace(/<script>.*<\/script>/, '') },
        )!;
        expect(section.settings.text).toEqual({ bn: '<p>ক</p>', en: '' });
    });

    it('drops link addresses from stored data, and keeps the core’s safe ones for the storefront', () => {
        const raw = {
            type: 'banner',
            settings: { link: { type: 'search', href: '/search/' } },
        };
        expect(readSection(raw)!.settings.link).toEqual({ type: 'search' });
        expect(readSection(raw, { keepHrefs: true })!.settings.link).toEqual({
            type: 'search',
            href: '/search/',
        });
        for (const href of ['javascript:alert(1)', '//evil.example', 'data:text/html,x', 42]) {
            const unsafe = { type: 'banner', settings: { link: { type: 'none', href } } };
            expect(readSection(unsafe, { keepHrefs: true })!.settings.link).toEqual({ type: 'none' });
        }
        const block = readSection(
            {
                type: 'image-grid',
                blocks: [{ settings: { link: { type: 'anchor', anchor: 'faq', href: '#faq' } } }],
            },
            { keepHrefs: true },
        )!;
        expect(block.blocks[0]!.settings.link).toEqual({ type: 'anchor', anchor: 'faq', href: '#faq' });
    });

    it('reads styles leniently', () => {
        expect(readStyle({ background: 'image', backgroundImage: null })).toMatchObject({
            background: 'none',
        });
        expect(
            readStyle({ background: 'image', backgroundImage: { assetId: '3', preview: '/a' } }),
        ).toMatchObject({
            background: 'image',
            backgroundImage: { assetId: '3', preview: '/a' },
        });
        expect(
            readStyle({ spacing: 'xl', anchor: 'Order Now', animate: true, hideOn: 'phone' }),
        ).toMatchObject({
            spacing: 'm',
            anchor: 'order-now',
            animate: true,
            hideOn: 'phone',
        });
        expect(readStyle('x', { width: 'full' })).toEqual({ ...DEFAULT_STYLE, width: 'full' });
    });
});

describe('data migrations', () => {
    // A section whose version 1 had one `title` field; version 2 split it into heading and text,
    // and version 3 renamed a select value. Real sections are all at version 1 so far.
    const versioned = defineSection({
        type: 'test-versioned',
        version: 3,
        name: { bn: 'পরীক্ষা', en: 'Test' },
        description: { bn: 'পরীক্ষা', en: 'Test' },
        category: 'content',
        icon: 'rich-text',
        fields: {
            heading: field.text({ bn: 'শিরোনাম', en: 'Heading' }),
            text: field.text({ bn: 'লেখা', en: 'Text' }),
            size: field.select(
                { bn: 'আকার', en: 'Size' },
                [{ value: 'medium', label: { bn: 'ম', en: 'M' } }],
                'medium',
            ),
        },
        migrations: {
            1: data => {
                const [heading = '', text = ''] = String(data.settings.title ?? '').split('|');
                return { ...data, settings: { heading, text } };
            },
            2: data => ({
                ...data,
                settings: {
                    ...data.settings,
                    size: data.settings.size === 'm' ? 'medium' : data.settings.size,
                },
            }),
        },
    });

    it('runs each migration from the stored version up', () => {
        const migrated = migrateSection(
            versioned,
            { settings: { title: 'Sale|Today only', size: 'm' }, blocks: [] },
            1,
        );
        expect(migrated.settings).toEqual({ heading: 'Sale', text: 'Today only', size: undefined });
        expect(migrateSection(versioned, { settings: { size: 'm' }, blocks: [] }, 2).settings).toEqual({
            size: 'medium',
        });
        expect(migrateSection(versioned, { settings: { a: 1 }, blocks: [] }, 3).settings).toEqual({ a: 1 });
    });

    it('skips versions without a migration', () => {
        const data = { settings: { kept: true }, blocks: [] };
        expect(migrateSection({ ...versioned, migrations: undefined }, data, 1)).toBe(data);
    });

    it('keeps data from a newer release readable', () => {
        const section = readSection({ type: 'divider', v: 9, settings: { line: false, future: 1 } })!;
        expect(section.v).toBe(9);
        expect(section.settings).toEqual({ line: false });
    });
});

describe('publishing checks', () => {
    it('reports broken links in shown fields only, with their section and block', () => {
        const hero = createSection('hero');
        hero.settings.link = { type: 'url', url: 'not-a-link' };
        const faq = createSection('faq');
        const grid = createSection('product-grid');
        const gallery = createSection('image-grid');
        gallery.blocks[0]!.settings.link = { type: 'anchor', anchor: '' };
        const video = createSection('video');
        video.settings.video = 'https://vimeo.com/1';
        const issues = documentIssues({ sections: [hero, faq, grid, gallery, video] });
        expect(issues).toEqual([
            { sectionId: hero.uid, field: 'link', code: 'invalidUrl' },
            { sectionId: gallery.uid, blockId: gallery.blocks[0]!.uid, field: 'link', code: 'invalidAnchor' },
            { sectionId: video.uid, field: 'video', code: 'invalidVideo' },
        ]);
    });

    it('reports repeated anchors and too many sections', () => {
        const first = createSection('divider');
        const second = createSection('divider');
        first.style.anchor = 'order';
        second.style.anchor = 'order';
        expect(documentIssues({ sections: [first, second] })).toEqual([
            { sectionId: second.uid, field: 'style.anchor', code: 'duplicateAnchor' },
        ]);
        const many = Array.from({ length: LAYOUT_LIMITS.sections + 1 }, () => createSection('divider'));
        expect(documentIssues({ sections: many })).toEqual([
            { sectionId: many[40]!.uid, field: 'sections', code: 'tooManySections' },
        ]);
    });

    it('skips fields hidden by a condition', () => {
        const grid = createSection('product-grid');
        const visits = [...eachField({ sections: [grid, { ...createSection('divider'), type: 'gone' }] })];
        expect(visits.find(visit => visit.name === 'collection')?.shown).toBe(false);
        expect(visits.find(visit => visit.name === 'count')?.shown).toBe(true);
        expect(visits.every(visit => visit.section.type === 'product-grid')).toBe(true);
    });
});

describe('references', () => {
    function sample() {
        const grid = createSection('product-grid');
        grid.settings.products = ['10', '11'];
        grid.settings.collection = '5';
        const list = createSection('collection-list');
        list.settings.collections = ['5', '6'];
        const hero = createSection('hero');
        hero.settings.image = { assetId: '100', preview: '/a.jpg' };
        hero.settings.link = { type: 'page', ref: '3' };
        hero.settings.secondLink = { type: 'category', ref: '7' };
        hero.style.backgroundImage = { assetId: '101', preview: '/b.jpg' };
        const featured = createSection('featured-product');
        featured.settings.product = '12';
        featured.hidden = true;
        const gallery = createSection('image-grid');
        gallery.blocks[0]!.settings.image = { assetId: '102', preview: '/c.jpg' };
        gallery.blocks[0]!.settings.link = { type: 'product', ref: '13' };
        return { sections: [grid, list, hero, featured, gallery] };
    }

    it('lists products, categories, pages and images of shown sections', () => {
        expect(documentRefs(sample())).toEqual({
            products: ['10', '11', '13'],
            collections: ['5', '6', '7'],
            pages: ['3'],
            assets: ['100', '101', '102'],
        });
        expect(documentRefs(sample(), { includeHidden: true }).products).toContain('12');
    });

    it('maps every ID (the Admin API encodes and decodes them)', () => {
        const mapped = mapDocumentIds(sample(), (kind, id) => `${kind[0]}${id}`);
        expect(documentRefs(mapped, { includeHidden: true })).toEqual({
            products: ['p10', 'p11', 'p12', 'p13'],
            collections: ['c5', 'c6', 'c7'],
            pages: ['p3'],
            assets: ['a100', 'a101', 'a102'],
        });
        const empty = mapDocumentIds({ sections: [createSection('featured-product')] }, () => 'x');
        expect(empty.sections[0]!.settings.product).toBeNull();
    });

    it('maps links (the core adds href)', () => {
        const mapped = mapLinks(sample(), link => ({ ...link, href: `/${link.type}/` }));
        expect(mapped.sections[2]!.settings.link).toEqual({ type: 'page', ref: '3', href: '/page/' });
        expect(mapped.sections[4]!.blocks[0]!.settings.link).toEqual({
            type: 'product',
            ref: '13',
            href: '/product/',
        });
        expect(mapped.sections[0]!.settings.products).toEqual(['10', '11']);
    });

    it('copies a section with new IDs', () => {
        const faq = createSection('faq');
        const copy = copySection(faq);
        expect(copy.uid).not.toBe(faq.uid);
        expect(copy.blocks.map(block => block.uid)).not.toEqual(faq.blocks.map(block => block.uid));
        expect(copy.settings).toEqual(faq.settings);
        (copy.blocks[0]!.settings.question as { bn: string }).bn = 'changed';
        expect((faq.blocks[0]!.settings.question as { bn: string }).bn).not.toBe('changed');
        expect(newId()).toMatch(/^[a-z0-9]{8}$/);
    });
});

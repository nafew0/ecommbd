import { describe, expect, it } from 'vitest';
import { canPublish, estimateScriptKb, pageChecklist, SCRIPT_BUDGET_KB } from './checklist';
import type { SectionData } from './define';
import { createSection } from './document';
import { landingTemplate } from './landing-templates';
import { READY_SECTIONS, STORE_DESIGNS } from './library';
import { createNode, type NodeData } from './nodes';
import { openSection } from './open';
import { starterLayout } from './starters';

function free(children: NodeData[], uid = 'free0001'): SectionData {
    return { ...createSection('custom'), uid, children };
}
const text = (en: string, bn = en) => ({ bn, en });
const codes = (section: SectionData) => pageChecklist({ sections: [section] }).map(item => item.code);
const heading = (words = 'Winter sale', props: Record<string, unknown> = {}) =>
    createNode('heading', { text: text(words), ...props });

describe('the pre-publish checklist (phase 62)', () => {
    it('finds nothing on a page that is ready', () => {
        const section = free([
            heading(),
            createNode('text', { text: text('<p>Our own words.</p>') }),
            createNode('button', { label: text('Buy'), link: { type: 'search' } }),
            createNode('image', { image: { assetId: '3', preview: '' }, alt: text('A red shawl') }),
        ]);
        expect(pageChecklist({ sections: [section, createSection('hero')] })).toEqual([]);
        expect(canPublish([])).toBe(true);
    });

    it('catches missing and sample content', () => {
        const empty = heading('');
        const sample = createNode('heading');
        const noLink = createNode('button', { label: text('Buy'), link: { type: 'none' } });
        const noLabel = createNode('button', { label: text(''), link: { type: 'search' } });
        const noImage = createNode('image');
        const noDate = createNode('countdown');
        const section = free([empty, sample, noLink, noLabel, noImage, noDate]);
        expect(pageChecklist({ sections: [section] })).toEqual([
            { code: 'emptyText', level: 'warning', sectionId: 'free0001', nodeId: empty.uid },
            { code: 'sampleText', level: 'warning', sectionId: 'free0001', nodeId: sample.uid },
            { code: 'buttonNoLink', level: 'warning', sectionId: 'free0001', nodeId: noLink.uid },
            { code: 'emptyText', level: 'warning', sectionId: 'free0001', nodeId: noLabel.uid },
            { code: 'missingImage', level: 'warning', sectionId: 'free0001', nodeId: noImage.uid },
            { code: 'noDeadline', level: 'warning', sectionId: 'free0001', nodeId: noDate.uid },
        ]);
        // A free section with only empty containers, or nothing at all.
        expect(codes(free([createNode('container')]))).toEqual(['emptySection']);
        expect(codes(free([]))).toEqual(['emptySection']);
        // Hidden things aren't checked: shoppers never see them.
        expect(codes(free([{ ...empty, hidden: true }, heading()]))).toEqual([]);
        expect(pageChecklist({ sections: [{ ...section, hidden: true }] })).toEqual([]);
    });

    it('catches broken links as blockers, first in the list', () => {
        const broken = createNode('button', { label: text('Buy'), link: { type: 'url', url: 'nope' } });
        const items = pageChecklist({ sections: [free([createNode('heading'), broken])] });
        expect(items.map(item => [item.code, item.level])).toEqual([
            ['invalidUrl', 'blocker'],
            ['sampleText', 'warning'],
        ]);
        expect(items[0]!.nodeId).toBe(broken.uid);
        expect(canPublish(items)).toBe(false);
    });

    it('asks for a description of a photo, as a tip', () => {
        const photo = createNode('image', { image: { assetId: '3', preview: '' } });
        expect(pageChecklist({ sections: [free([photo])] })).toEqual([
            { code: 'missingAlt', level: 'tip', sectionId: 'free0001', nodeId: photo.uid },
        ]);
    });

    it('warns about text that is hard to read on its background', () => {
        const pale = { ...heading(), style: { base: { color: '#cccccc', background: '#ffffff' } } };
        const fine = { ...heading(), style: { base: { color: '#111111', background: '#ffffff' } } };
        expect(codes(free([pale, fine]))).toEqual(['lowContrast']);
        // The background of the container around it counts, and so does the section's own design.
        const box = { ...createNode('container'), style: { base: { background: '#111111' } } };
        box.children = [{ ...heading(), style: { base: { color: '#222222' } } }];
        expect(codes(free([box]))).toEqual(['lowContrast']);
        const section = free([{ ...heading(), style: { base: { color: '#eeeeee' } } }]);
        section.style.design = { ...section.style.design, background: '#ffffff' };
        expect(codes(section)).toEqual(['lowContrast']);
        // Readable on computers, unreadable on phones: still a warning.
        const phone = {
            ...heading(),
            style: { base: { color: '#111111', background: '#ffffff' }, phone: { color: '#eeeeee' } },
        };
        expect(codes(free([phone]))).toEqual(['lowContrast']);
        // Nothing set: the theme's own colours, which the theme screen already checks.
        expect(codes(free([heading()]))).toEqual([]);
    });

    it('allows one page title', () => {
        const first = heading('One', { tag: 'h1' });
        const second = heading('Two', { tag: 'h1' });
        const third = heading('Three', { tag: 'h1' });
        const items = pageChecklist({
            sections: [free([first, heading('Sub')]), free([second, third], 'free0002')],
        });
        expect(items).toEqual([
            { code: 'manyH1', level: 'warning', sectionId: 'free0002', nodeId: second.uid },
            { code: 'manyH1', level: 'warning', sectionId: 'free0002', nodeId: third.uid },
        ]);
    });

    it('notes Bangla words in a font without Bangla letters, and an element hidden everywhere', () => {
        const serif = {
            ...heading('Sale', { text: text('Sale', 'ছাড়') }),
            style: { base: { fontFamily: 'serif' as const } },
        };
        const english = {
            ...heading('Sale', { text: text('Sale', '') }),
            style: { base: { fontFamily: 'mono' as const } },
        };
        const gone = { ...heading(), hideOn: ['base', 'tablet', 'phone'] as NodeData['hideOn'] };
        expect(pageChecklist({ sections: [free([serif, english, gone])] })).toEqual([
            { code: 'banglaFont', level: 'tip', sectionId: 'free0001', nodeId: serif.uid },
            { code: 'hiddenEverywhere', level: 'tip', sectionId: 'free0001', nodeId: gone.uid },
        ]);
    });

    it('estimates the script a page loads, and blocks a page over its budget', () => {
        expect(estimateScriptKb({ sections: [] })).toBe(3);
        expect(estimateScriptKb({ sections: [createSection('hero'), createSection('faq')] })).toBe(3);
        const countdown = createNode('countdown', { endsAt: '2030-01-01T00:00:00.000Z' });
        const video = createNode('video', { video: 'https://youtu.be/dQw4w9WgXcQ' });
        // Each kind counts once, however many there are; hidden ones don't load.
        expect(
            estimateScriptKb({ sections: [free([countdown, countdown, video, { ...video, hidden: true }])] }),
        ).toBe(4.4);
        expect(
            estimateScriptKb({
                sections: [createSection('slideshow'), openSection(createSection('order-form'))!],
            }),
        ).toBe(5.6);
        // Everything we ship today fits with room to spare.
        for (const layout of [
            starterLayout('gadgets'),
            landingTemplate('seasonal-combo')!.build({ name: text('X') }),
        ]) {
            expect(estimateScriptKb(layout)).toBeLessThan(SCRIPT_BUDGET_KB.page / 3);
            expect(
                pageChecklist(layout, { layoutType: 'landing' }).some(item => item.code === 'budget'),
            ).toBe(false);
        }
    });

    it('finds nothing to block in any ready section or store design', () => {
        for (const item of READY_SECTIONS) {
            const found = pageChecklist({ sections: [item.build()] });
            expect(canPublish(found), item.id).toBe(true);
            // Our own designs never ship unreadable text or a second page title.
            expect(
                found.filter(check => ['lowContrast', 'manyH1', 'banglaFont'].includes(check.code)),
                item.id,
            ).toEqual([]);
        }
        for (const design of STORE_DESIGNS) {
            expect(canPublish(pageChecklist(design.build({ name: 'X', description: '' }))), design.id).toBe(
                true,
            );
        }
    });
});

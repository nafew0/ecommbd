import { createSection, LAYOUT_LIMITS, type LayoutDocument } from '@ecommbd/sections';
import { describe, expect, it } from 'vitest';
import {
    addBlock,
    anchorsOf,
    duplicateSection,
    insertSection,
    moveBlock,
    moveSection,
    removeBlock,
    removeSection,
    sectionLabel,
    setBlockSetting,
    setHidden,
    setSetting,
    setStyle,
} from './document-ops';

function page(): LayoutDocument {
    return { sections: [createSection('hero'), createSection('faq'), createSection('divider')] };
}

describe('page editor document changes', () => {
    it('changes settings, block settings and style without touching the original', () => {
        const before = page();
        const [hero, faq] = before.sections;
        const heading = { bn: 'ঈদ অফার', en: 'Eid offer' };
        const after = setStyle(
            setBlockSetting(
                setSetting(before, hero!.uid, 'heading', heading),
                faq!.uid,
                faq!.blocks[0]!.uid,
                'question',
                heading,
            ),
            hero!.uid,
            { background: 'dark' },
        );
        expect(after.sections[0]!.settings.heading).toEqual(heading);
        expect(after.sections[0]!.style.background).toBe('dark');
        expect(after.sections[1]!.blocks[0]!.settings.question).toEqual(heading);
        expect(before.sections[0]!.settings.heading).not.toEqual(heading);
        expect(before.sections[0]!.style.background).toBe('none');
        expect(setHidden(before, hero!.uid, true).sections[0]!.hidden).toBe(true);
    });

    it('moves, inserts and removes sections, at most 40', () => {
        const before = page();
        const moved = moveSection(before, 0, 2);
        expect(moved.sections.map(section => section.type)).toEqual(['faq', 'divider', 'hero']);
        expect(moveSection(before, 0, 5)).toBe(before);
        const banner = createSection('banner');
        expect(insertSection(before, banner, 1).sections.map(section => section.type)).toEqual([
            'hero',
            'banner',
            'faq',
            'divider',
        ]);
        expect(insertSection(before, banner).sections.at(-1)!.type).toBe('banner');
        const full = {
            sections: Array.from({ length: LAYOUT_LIMITS.sections }, () => createSection('divider')),
        };
        expect(insertSection(full, banner)).toBe(full);
        expect(duplicateSection(full, full.sections[0]!.uid)).toEqual({ document: full, copy: null });
        expect(removeSection(before, before.sections[1]!.uid).sections.map(section => section.type)).toEqual([
            'hero',
            'divider',
        ]);
    });

    it('duplicates a section right below it with new IDs', () => {
        const before = page();
        const { document, copy } = duplicateSection(before, before.sections[1]!.uid);
        expect(document.sections.map(section => section.type)).toEqual(['hero', 'faq', 'faq', 'divider']);
        expect(copy!.uid).not.toBe(before.sections[1]!.uid);
        expect(document.sections[2]).toBe(copy);
        expect(duplicateSection(before, 'missing').copy).toBeNull();
    });

    it('adds, moves and removes blocks within their limits', () => {
        const before = page();
        const faq = before.sections[1]!;
        const added = addBlock(before, faq.uid);
        expect(added.sections[1]!.blocks).toHaveLength(faq.blocks.length + 1);
        const reordered = moveBlock(added, faq.uid, 0, 1);
        expect(reordered.sections[1]!.blocks[1]!.uid).toBe(faq.blocks[0]!.uid);
        expect(moveBlock(added, faq.uid, 0, 99)).toEqual(added);
        const removed = removeBlock(added, faq.uid, faq.blocks[0]!.uid);
        expect(removed.sections[1]!.blocks.map(block => block.uid)).not.toContain(faq.blocks[0]!.uid);
        // A divider has no blocks; an FAQ keeps at least one question.
        expect(addBlock(before, before.sections[2]!.uid)).toEqual(before);
        let single = before;
        for (const block of faq.blocks.slice(1)) single = removeBlock(single, faq.uid, block.uid);
        expect(removeBlock(single, faq.uid, faq.blocks[0]!.uid).sections[1]!.blocks).toHaveLength(1);
    });

    it('names sections for the list and lists their anchors', () => {
        const before = page();
        expect(sectionLabel(before.sections[0]!, 'en')).toEqual({
            name: 'Hero',
            detail: 'The new collection is here',
        });
        expect(sectionLabel(before.sections[1]!, 'bn')).toEqual({
            name: 'প্রশ্ন ও উত্তর',
            detail: 'সাধারণ প্রশ্ন',
        });
        expect(sectionLabel(before.sections[2]!, 'en')).toEqual({ name: 'Divider', detail: '' });
        const withAnchor = setStyle(before, before.sections[1]!.uid, { anchor: 'faq' });
        expect(anchorsOf(withAnchor, 'en')).toEqual([{ anchor: 'faq', label: 'FAQ' }]);
    });
});

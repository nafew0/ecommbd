import {
    createNode,
    createSection,
    createStructure,
    findNode,
    LAYOUT_LIMITS,
    type LayoutDocument,
    NODE_LIMITS,
    STRUCTURE_PRESETS,
} from '@ecommbd/sections';
import { describe, expect, it } from 'vitest';
import {
    addBlock,
    anchorsOf,
    duplicateNode,
    duplicateSection,
    insertNode,
    insertSection,
    moveNode,
    nodeName,
    nodePath,
    openUpSection,
    removeNode,
    setNodeProp,
    setNodeStyle,
    updateNode,
    updateSection,
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

describe('changes to a free section’s tree', () => {
    const free = () => {
        const section = createSection('custom');
        return { document: { sections: [section, createSection('hero')] } as LayoutDocument, section };
    };
    const tree = (document: LayoutDocument) => document.sections[0]!.children!;

    it('changes a node’s props and its style for one device, leaving the original alone', () => {
        const { document, section } = free();
        const heading = tree(document)[0]!.children![1]!.children![0]!;
        const text = { bn: 'নতুন', en: 'New' };
        const after = setNodeStyle(
            setNodeStyle(
                setNodeProp(document, section.uid, heading.uid, 'text', text),
                section.uid,
                heading.uid,
                'phone',
                'fontSize',
                20,
            ),
            section.uid,
            heading.uid,
            'base',
            'color',
            '#112233',
        );
        const changed = findNode(tree(after), heading.uid)!.node;
        expect(changed.props.text).toEqual(text);
        expect(changed.style).toEqual({ base: { color: '#112233' }, phone: { fontSize: 20 } });
        expect(heading.style).toEqual({ base: {} });
        // Clearing the only value of a device removes the device.
        const cleared = setNodeStyle(after, section.uid, heading.uid, 'phone', 'fontSize', null);
        expect(findNode(tree(cleared), heading.uid)!.node.style).toEqual({ base: { color: '#112233' } });
    });

    it('adds inside a container or at the top, moves among siblings, duplicates and removes', () => {
        const { document, section } = free();
        const [grid] = tree(document);
        const right = grid!.children![1]!;
        const badge = createNode('badge');
        let next = insertNode(document, section.uid, right.uid, badge, 0).document;
        expect(findNode(tree(next), right.uid)!.node.children!.map(node => node.type)).toEqual([
            'badge',
            'heading',
            'text',
            'button',
        ]);
        next = moveNode(next, section.uid, badge.uid, 1);
        next = moveNode(next, section.uid, badge.uid, 1);
        // Already last: nothing moves.
        next = moveNode(moveNode(next, section.uid, badge.uid, 1), section.uid, badge.uid, 1);
        expect(findNode(tree(next), right.uid)!.node.children!.at(-1)!.uid).toBe(badge.uid);
        const copied = duplicateNode(next, section.uid, right.uid);
        expect(tree(copied.document)[0]!.children!.map(node => node.children!.length)).toEqual([1, 4, 4]);
        expect(copied.copy!.uid).not.toBe(right.uid);
        const top = insertNode(next, section.uid, null, createNode('divider')).document;
        expect(tree(top).map(node => node.type)).toEqual(['container', 'divider']);
        expect(tree(removeNode(top, section.uid, grid!.uid)).map(node => node.type)).toEqual(['divider']);
        // An element can't hold other nodes, and a ready-made section has no tree.
        expect(insertNode(document, section.uid, badge.uid, createNode('divider')).document).toBe(document);
        expect(insertNode(document, document.sections[1]!.uid, null, badge).document).toBe(document);
    });

    it('refuses containers nested deeper than three, and more than 400 nodes', () => {
        const { document, section } = free();
        const column = tree(document)[0]!.children![0]!;
        const third = createNode('container');
        const withThird = insertNode(document, section.uid, column.uid, third);
        expect(withThird.refused).toBeUndefined();
        const fourth = insertNode(withThird.document, section.uid, third.uid, createNode('container'));
        expect(fourth.refused).toBe('tooDeep');
        expect(fourth.document).toBe(withThird.document);
        // A two-level layout fits at the top, not inside the second level.
        const structure = createStructure(STRUCTURE_PRESETS[1]);
        expect(insertNode(document, section.uid, null, structure).refused).toBeUndefined();
        expect(insertNode(document, section.uid, column.uid, structure).refused).toBe('tooDeep');
        expect(duplicateNode(withThird.document, section.uid, third.uid).refused).toBeUndefined();

        let full = document;
        while (!insertNode(full, section.uid, null, createNode('divider')).refused) {
            full = insertNode(full, section.uid, null, createNode('divider')).document;
        }
        expect(insertNode(full, section.uid, null, createNode('divider')).refused).toBe('tooManyNodes');
        expect(tree(full)).toHaveLength(NODE_LIMITS.nodes - 7 + 1);
    });

    it('opens a ready-made section up, names nodes and finds the way to one', () => {
        const { document, section } = free();
        const hero = document.sections[1]!;
        const opened = openUpSection(document, hero.uid);
        expect(opened.sections[1]).toMatchObject({ uid: hero.uid, type: 'custom' });
        expect(openUpSection(document, section.uid)).toEqual(document);
        expect(sectionLabel(opened.sections[1]!, 'en').detail).toBe('The new collection is here');

        const button = tree(document)[0]!.children![1]!.children![2]!;
        expect(nodePath(tree(document), button.uid).map(node => nodeName(node, 'en'))).toEqual([
            'Grid',
            'Column',
            'Button',
        ]);
        expect(nodeName({ ...button, label: 'Buy button' }, 'bn')).toBe('Buy button');
        const faq = createSection('faq');
        const opened2 = openUpSection({ sections: [faq] }, faq.uid);
        const liveNode = opened2.sections[0]!.children![0]!;
        expect(nodeName(liveNode, 'en')).toBe('FAQ');
        // A change to the section inside a live block.
        const renamed = updateNode(opened2, faq.uid, liveNode.uid, node => ({
            ...node,
            section: updateSection({ sections: [node.section!] }, node.section!.uid, item => ({
                ...item,
                hidden: true,
            })).sections[0]!,
        }));
        expect(renamed.sections[0]!.children![0]!.section!.hidden).toBe(true);
    });
});

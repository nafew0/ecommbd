import { type Bilingual, findNode, type LayoutDocument, type NodeData } from '@ecommbd/sections';
import { useRef } from 'react';
import {
    duplicateNode,
    duplicateSection,
    insertNode,
    insertSection,
    moveNode,
    moveNodeTo,
    readClip,
    removeNode,
    removeSection,
    setNodeProp,
    writeClip,
} from './document-ops';
import type { PreviewMessage } from './preview-frame';

/**
 * What the canvas and the keyboard do to the page (roadmap phase 58). The preview frame only
 * reports what the merchant did there (clicked a node, pressed a toolbar button, finished
 * typing, dropped something); the document changes here, like every other change, so undo,
 * autosave and the limits all apply.
 */

interface CanvasOptions {
    document: LayoutDocument;
    change(document: LayoutDocument, key?: string): void;
    undo(): void;
    redo(): void;
    /** Saves now. */
    flush(): Promise<void>;
    selected: string | null;
    selectedNode: string | null;
    select(sectionUid: string | null, nodeUid?: string | null): void;
    /** The language being written: text typed on the canvas is in it. */
    language: 'bn' | 'en';
    /** Tells the preview frame something. */
    post(message: PreviewMessage): void;
    /** Opens the section library, to add at this place in the page. */
    addSectionAt(index: number): void;
    /** Opens the picker of a container (null: the section's own) in the settings panel. */
    addInside(nodeUid: string | null): void;
    toggleExpanded(): void;
    showShortcuts(): void;
    expanded: boolean;
    /** Messages for toasts: `refused` by code, and a few fixed ones. */
    say: {
        refused: Record<string, string>;
        copied: string;
        pasted: string;
        nothingToPaste: string;
        pasteNeedsSection: string;
        savedNow: string;
        tooMany: string;
    };
    toast: { success(text: string): void; error(text: string): void; info(text: string): void };
}

type Dragged = { kind: 'new'; make(): NodeData } | { kind: 'node'; uid: string; node: string };

/** The place in a container's children of the nth one that shows (hidden ones aren't on the canvas). */
function shownIndex(children: readonly NodeData[], index: number): number {
    let seen = 0;
    for (const [place, child] of children.entries()) {
        if (child.hidden) continue;
        if (seen === index) return place;
        seen++;
    }
    return children.length;
}

export function useCanvas(o: CanvasOptions) {
    const dragged = useRef<Dragged | null>(null);
    const { document, say, toast } = o;
    const section = document.sections.find(item => item.uid === o.selected) ?? null;
    const tree = section?.children ?? null;
    const current = tree && o.selectedNode ? findNode(tree, o.selectedNode) : null;
    const refuse = (code: string) => toast.error(say.refused[code] ?? code);

    const duplicate = () => {
        if (section && current) {
            const result = duplicateNode(document, section.uid, current.node.uid);
            if (result.refused) return refuse(result.refused);
            o.change(result.document);
            if (result.copy) o.select(section.uid, result.copy.uid);
        } else if (section) {
            const result = duplicateSection(document, section.uid);
            if (!result.copy) return toast.error(say.tooMany);
            o.change(result.document);
            o.select(result.copy.uid);
        }
    };

    const remove = () => {
        if (section && current) {
            o.change(removeNode(document, section.uid, current.node.uid));
            o.select(section.uid, current.parent?.uid ?? null);
        } else if (section) {
            o.change(removeSection(document, section.uid));
            o.select(null);
        }
    };

    const copy = () => {
        const ok = current
            ? writeClip({ kind: 'node', node: current.node })
            : section
              ? writeClip({ kind: 'section', section })
              : false;
        if (ok) toast.success(say.copied);
    };

    const paste = () => {
        const clip = readClip();
        if (!clip) return toast.info(say.nothingToPaste);
        if (clip.kind === 'section') {
            const at = section ? document.sections.indexOf(section) + 1 : document.sections.length;
            const next = insertSection(document, clip.section, at);
            if (next === document) return toast.error(say.tooMany);
            o.change(next);
            o.select(clip.section.uid);
        } else {
            if (!section || !tree) return toast.info(say.pasteNeedsSection);
            // Into a selected container; after a selected element; else at the end of the section.
            const into = current?.node.type === 'container' ? current.node : (current?.parent ?? null);
            const siblings = into ? into.children! : tree;
            const at =
                current && current.node !== into ? siblings.indexOf(current.node) + 1 : siblings.length;
            const result = insertNode(document, section.uid, into?.uid ?? null, clip.node, at);
            if (result.refused) return refuse(result.refused);
            o.change(result.document);
            o.select(section.uid, clip.node.uid);
        }
        toast.success(say.pasted);
    };

    /** Selects the one before or after: a sibling node, or a section. */
    const step = (by: -1 | 1) => {
        if (section && current) {
            const siblings = current.parent?.children ?? tree!;
            const next = siblings[siblings.indexOf(current.node) + by];
            if (next) o.select(section.uid, next.uid);
        } else {
            const index = section
                ? document.sections.indexOf(section) + by
                : by === 1
                  ? 0
                  : document.sections.length - 1;
            const next = document.sections[index];
            if (next) o.select(next.uid);
        }
    };

    /** A shortcut, from this window or sent on by the preview frame. True when it did something. */
    const runKey = (key: string, command: boolean, shift: boolean): boolean => {
        if (command) {
            if (key === 'z') (shift ? o.redo : o.undo)();
            else if (key === 'y') o.redo();
            else if (key === 's') void o.flush().then(() => toast.success(say.savedNow));
            else if (key === 'c') copy();
            else if (key === 'v') paste();
            else if (key === 'd') duplicate();
            else return false;
            return true;
        }
        if (key === 'Delete' || key === 'Backspace') {
            if (!section) return false;
            remove();
        } else if (key === 'ArrowUp') step(-1);
        else if (key === 'ArrowDown') step(1);
        else if (key === 'Escape') {
            if (o.expanded) o.toggleExpanded();
            else if (current) o.select(section!.uid, current.parent?.uid ?? null);
            else if (section) o.select(null);
            else return false;
        } else if (key === 'p') o.toggleExpanded();
        else if (key === '?') o.showShortcuts();
        else return false;
        return true;
    };

    /** A message from the preview frame. True when it was one of the canvas's. */
    const onMessage = (message: PreviewMessage): boolean => {
        const uid = typeof message.uid === 'string' ? message.uid : null;
        const nodeUid = typeof message.node === 'string' ? message.node : null;
        const target = document.sections.find(item => item.uid === uid);
        switch (message.type) {
            case 'node-action': {
                if (!target?.children || !nodeUid) return true;
                const found = findNode(target.children, nodeUid);
                if (!found) return true;
                if (message.action === 'up' || message.action === 'down') {
                    o.change(moveNode(document, target.uid, nodeUid, message.action === 'up' ? -1 : 1));
                } else if (message.action === 'parent') {
                    o.select(target.uid, found.parent?.uid ?? null);
                } else if (message.action === 'duplicate') {
                    const result = duplicateNode(document, target.uid, nodeUid);
                    if (result.refused) refuse(result.refused);
                    else {
                        o.change(result.document);
                        if (result.copy) o.select(target.uid, result.copy.uid);
                    }
                } else if (message.action === 'remove') {
                    o.change(removeNode(document, target.uid, nodeUid));
                    o.select(target.uid, found.parent?.uid ?? null);
                }
                return true;
            }
            case 'text': {
                const found = target?.children && nodeUid ? findNode(target.children, nodeUid) : null;
                const field = typeof message.field === 'string' ? message.field : '';
                if (!found || !field || typeof message.value !== 'string') return true;
                const before = found.node.props[field] as Bilingual | undefined;
                // Typed on the canvas, in the language the preview shows.
                const text = { bn: '', en: '', ...before, [o.language]: message.value };
                o.change(
                    setNodeProp(document, target!.uid, nodeUid!, field, text),
                    `${nodeUid}.${field}.${o.language}`,
                );
                return true;
            }
            case 'add-section': {
                const after = document.sections.findIndex(item => item.uid === message.after);
                o.addSectionAt(after < 0 ? document.sections.length : after + 1);
                return true;
            }
            case 'add-inside':
                if (target) {
                    o.select(target.uid, nodeUid);
                    o.addInside(nodeUid);
                }
                return true;
            case 'key':
                runKey(String(message.key), message.command === true, message.shift === true);
                return true;
            case 'drag-start':
                if (uid && nodeUid) dragged.current = { kind: 'node', uid, node: nodeUid };
                return true;
            case 'drag-end':
                dragged.current = null;
                return true;
            case 'drop': {
                const drag = dragged.current;
                dragged.current = null;
                o.post({ type: 'drag', active: false });
                if (!drag || !target?.children) return true;
                const parentUid = typeof message.parent === 'string' ? message.parent : null;
                const holder = parentUid
                    ? findNode(target.children, parentUid)?.node.children
                    : target.children;
                if (!holder) return true;
                const index = shownIndex(holder, Number(message.index) || 0);
                if (drag.kind === 'new') {
                    const node = drag.make();
                    const result = insertNode(document, target.uid, parentUid, node, index);
                    if (result.refused) refuse(result.refused);
                    else {
                        o.change(result.document);
                        o.select(target.uid, node.uid);
                    }
                } else {
                    const result = moveNodeTo(document, drag.uid, drag.node, parentUid, index, target.uid);
                    if (result.refused) refuse(result.refused);
                    else {
                        o.change(result.document);
                        o.select(target.uid, drag.node);
                    }
                }
                return true;
            }
            default:
                return false;
        }
    };

    /** An element or layout picked up from the settings panel's list (null: let go without a drop). */
    const dragNew = (make: (() => NodeData) | null) => {
        if (make) dragged.current = { kind: 'new', make };
        // Letting go fires here and in the frame in no fixed order: the drop gets a moment to arrive.
        else window.setTimeout(() => (dragged.current = null), 300);
        o.post({ type: 'drag', active: !!make });
    };

    return { onMessage, runKey, dragNew };
}

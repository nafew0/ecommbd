import {
    type Device,
    findNode,
    type LayoutDocument,
    type NodeData,
    nodeSnippet,
    type SectionData,
} from '@ecommbd/sections';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { AnimatePresence, expand, m, rise } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import type { LayoutWarning } from './design-api';
import {
    duplicateNode,
    insertNode,
    moveNode,
    nodeName,
    nodePath,
    removeNode,
    updateNode,
} from './document-ops';
import { ElementIcon } from './element-icon';
import { ElementPicker } from './element-picker';
import type { Language } from './field-controls';
import { IconButton } from './icon-button';
import { NodeSettings } from './node-settings';

/**
 * A free section in the settings panel (roadmap phases 56 and 58). With nothing chosen it offers
 * what can be added to the section. With a node chosen (on the canvas, in the Navigator, or from
 * a container's own list here) it shows that node's settings (node-settings.tsx), with the way
 * back along the top. "Add inside" under a container opens the picker right there, so it's
 * always clear where the new element goes.
 */

interface NodeTreeProps {
    section: SectionData;
    document: LayoutDocument;
    language: Language;
    warnings: LayoutWarning[];
    onChange(document: LayoutDocument, key?: string): void;
    /** The node whose settings are open (null: the list). */
    selected: string | null;
    onSelect(uid: string | null): void;
    /** "Add inside" pressed on the canvas: open this container's picker (null: the section's own). */
    addInside?: { uid: string | null; at: number } | null;
    /** An element or layout picked up from the list, to drop on the canvas (null: let go). */
    onDragNew?(make: (() => NodeData) | null): void;
    /** A sales page: its own sections are offered as blocks. */
    landing?: boolean;
    /** The screen size being styled: the same one the preview shows. */
    device: Device;
    onDevice(device: Device): void;
}

export function NodeTree(props: NodeTreeProps) {
    const { section, document, language, warnings, onChange, device, onDevice } = props;
    const { selected, onSelect: setSelected } = props;
    const { messages: m_, language: ui } = useI18n();
    const d = m_.design;
    const t = d.tree;
    const toast = useToast();
    /** Where the picker is open: a container's uid, or `root` for the section itself. */
    const [adding, setAdding] = useState<string | null>(null);
    const nodes = section.children ?? [];
    const current = selected ? findNode(nodes, selected) : null;
    // The canvas asked for something new inside a container: its picker opens here.
    const request = props.addInside;
    useEffect(() => {
        if (request) setAdding(request.uid ?? 'root');
    }, [request]);

    const add = (parent: string | null, node: NodeData) => {
        const result = insertNode(document, section.uid, parent, node);
        if (result.refused) {
            toast.error(t.refused[result.refused] ?? result.refused);
            return;
        }
        onChange(result.document);
        setAdding(null);
        // A new element opens straight away; a new layout stays in the list to be filled.
        if (node.type !== 'container') setSelected(node.uid);
    };

    const issueOf = (node: NodeData) =>
        warnings.find(item => item.sectionId === section.uid && item.blockId === node.uid);

    const picker = (parent: string | null) => (
        <AnimatePresence initial={false}>
            {adding === (parent ?? 'root') && (
                <m.div {...expand} className="overflow-hidden">
                    <ElementPicker
                        onPick={node => add(parent, node)}
                        onDragNew={props.onDragNew}
                        landing={props.landing}
                    />
                </m.div>
            )}
        </AnimatePresence>
    );

    const addButton = (parent: string | null, label: string) => {
        const key = parent ?? 'root';
        return (
            <button
                type="button"
                aria-expanded={adding === key}
                onClick={() => setAdding(adding === key ? null : key)}
                className={cn(
                    'flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
                    adding === key && 'bg-surface-muted text-ink',
                )}
            >
                <ElementIcon
                    name="plus"
                    className={cn('size-4 transition-transform duration-200', adding === key && 'rotate-45')}
                />
                {label}
            </button>
        );
    };

    const rows = (list: readonly NodeData[], depth: number) =>
        list.map((node, index) => {
            const issue = issueOf(node);
            const snippet = nodeSnippet(node, language);
            return (
                <li key={node.uid}>
                    <div
                        className={cn(
                            'group flex items-center rounded transition-colors hover:bg-surface-muted',
                            node.hidden && 'opacity-55',
                        )}
                    >
                        <button
                            type="button"
                            onClick={() => {
                                setSelected(node.uid);
                                setAdding(null);
                            }}
                            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent"
                        >
                            <ElementIcon
                                name={node.type}
                                className={cn('size-4 shrink-0', issue ? 'text-danger' : 'text-ink-muted')}
                            />
                            <span className="shrink-0 font-medium text-ink">{nodeName(node, ui)}</span>
                            {snippet && <span className="truncate text-ink-muted">{snippet}</span>}
                        </button>
                        <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                            <IconButton
                                aria-label={`${d.moveUp}: ${nodeName(node, ui)}`}
                                title={d.moveUp}
                                disabled={index === 0}
                                onClick={() => onChange(moveNode(document, section.uid, node.uid, -1))}
                            >
                                <ElementIcon name="up" className="size-4" />
                            </IconButton>
                            <IconButton
                                aria-label={`${d.moveDown}: ${nodeName(node, ui)}`}
                                title={d.moveDown}
                                disabled={index === list.length - 1}
                                onClick={() => onChange(moveNode(document, section.uid, node.uid, 1))}
                            >
                                <ElementIcon name="down" className="size-4" />
                            </IconButton>
                        </span>
                    </div>
                    {node.children && (
                        <ul className="ml-4 border-l border-line pl-1.5">
                            {rows(node.children, depth + 1)}
                            <li>
                                {addButton(node.uid, t.addInside)}
                                {picker(node.uid)}
                            </li>
                        </ul>
                    )}
                </li>
            );
        });

    if (current) {
        const { node } = current;
        const siblings = current.parent?.children ?? nodes;
        const index = siblings.indexOf(node);
        const path = nodePath(nodes, node.uid);
        const general = warnings.filter(
            item =>
                item.sectionId === section.uid &&
                item.blockId === node.uid &&
                (item.field === '' || item.field === 'sections'),
        );
        return (
            <m.div key={node.uid} {...rise} className="space-y-5">
                <nav aria-label={t.path} className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
                    <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="-ml-1 flex min-h-8 items-center gap-1 rounded px-1 font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                    >
                        <ElementIcon name="back" className="size-4" />
                        {t.allElements}
                    </button>
                    {path.slice(0, -1).map(parent => (
                        <span key={parent.uid} className="flex items-center gap-1 text-ink-muted">
                            <span aria-hidden>/</span>
                            <button
                                type="button"
                                onClick={() => setSelected(parent.uid)}
                                className="min-h-8 rounded px-0.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                {nodeName(parent, ui)}
                            </button>
                        </span>
                    ))}
                </nav>
                <div className="flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-muted text-ink">
                        <ElementIcon name={node.type} className="size-4.5" />
                    </span>
                    <h3 className="min-w-0 flex-1 truncate font-semibold">{nodeName(node, ui)}</h3>
                    <IconButton
                        aria-label={node.hidden ? d.show : d.hide}
                        title={node.hidden ? d.show : d.hide}
                        onClick={() =>
                            onChange(
                                updateNode(document, section.uid, node.uid, item => ({
                                    ...item,
                                    hidden: !item.hidden,
                                })),
                            )
                        }
                    >
                        <ElementIcon name={node.hidden ? 'eye-off' : 'eye'} className="size-4" />
                    </IconButton>
                    <IconButton
                        aria-label={d.moveUp}
                        title={d.moveUp}
                        disabled={index === 0}
                        onClick={() => onChange(moveNode(document, section.uid, node.uid, -1))}
                    >
                        <ElementIcon name="up" className="size-4" />
                    </IconButton>
                    <IconButton
                        aria-label={d.moveDown}
                        title={d.moveDown}
                        disabled={index === siblings.length - 1}
                        onClick={() => onChange(moveNode(document, section.uid, node.uid, 1))}
                    >
                        <ElementIcon name="down" className="size-4" />
                    </IconButton>
                    <IconButton
                        aria-label={d.duplicate}
                        title={d.duplicate}
                        onClick={() => {
                            const result = duplicateNode(document, section.uid, node.uid);
                            if (result.refused) {
                                toast.error(t.refused[result.refused] ?? result.refused);
                                return;
                            }
                            onChange(result.document);
                            if (result.copy) setSelected(result.copy.uid);
                        }}
                    >
                        <ElementIcon name="copy" className="size-4" />
                    </IconButton>
                    <IconButton
                        tone="danger"
                        aria-label={d.remove}
                        title={d.remove}
                        onClick={() => {
                            onChange(removeNode(document, section.uid, node.uid));
                            setSelected(current.parent?.uid ?? null);
                        }}
                    >
                        <ElementIcon name="trash" className="size-4" />
                    </IconButton>
                </div>
                {general.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-line-strong bg-surface-muted px-3 py-2 text-sm text-danger">
                        {general.map(item => (
                            <li key={item.code}>{d.issues[item.code] ?? item.code}</li>
                        ))}
                    </ul>
                )}
                <NodeSettings
                    key={node.uid}
                    section={section}
                    node={node}
                    document={document}
                    language={language}
                    warnings={warnings}
                    onChange={onChange}
                    device={device}
                    onDevice={onDevice}
                    inside={
                        node.children && (
                            <section className="border-t border-line pt-4">
                                <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                    {t.inside}
                                </h4>
                                <ul>
                                    {rows(node.children, 0)}
                                    <li>
                                        {addButton(node.uid, t.addInside)}
                                        {picker(node.uid)}
                                    </li>
                                </ul>
                            </section>
                        )
                    }
                />
            </m.div>
        );
    }

    // The section itself: its layers are in the Navigator on the left and on the page; here is
    // where something new is added to the end of it.
    return (
        <div>
            <p className="mb-3 text-sm leading-relaxed text-ink-muted">
                {nodes.length === 0 ? t.empty : t.pickHint}
            </p>
            {addButton(null, t.add)}
            {picker(null)}
        </div>
    );
}

import { type LayoutDocument, type NodeData, nodeSnippet, type SectionData } from '@ecommbd/sections';
import { type DragEvent, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { duplicateNode, moveNodeTo, nodeName, removeNode, updateNode } from './document-ops';
import { ElementIcon } from './element-icon';
import { IconButton } from './icon-button';

/**
 * The Navigator (roadmap phase 58): a free section's containers and elements as nested layers,
 * under the section's row in the sidebar. A row selects its node, here and on the canvas. Drag a
 * row onto another to move it before, after or inside it; double-click a name to give the node a
 * name of your own (shown only in the editor); hide, duplicate or remove from the row itself.
 */

interface NavigatorProps {
    section: SectionData;
    document: LayoutDocument;
    language: 'bn' | 'en';
    selected: string | null;
    /** Lower-case words being searched for: only matching nodes and what holds them show. */
    query: string;
    /** Containers folded shut. */
    collapsed: ReadonlySet<string>;
    onToggle(uid: string): void;
    onSelect(nodeUid: string): void;
    onChange(document: LayoutDocument): void;
}

type Zone = 'before' | 'after' | 'inside';

/** True when a node, or anything inside it, matches the words searched for. */
export function nodeMatches(node: NodeData, query: string, language: 'bn' | 'en', ui: 'bn' | 'en'): boolean {
    if (!query) return true;
    const own = `${nodeName(node, ui)} ${nodeSnippet(node, language)}`.toLowerCase();
    return (
        own.includes(query) || (node.children ?? []).some(child => nodeMatches(child, query, language, ui))
    );
}

export function Navigator(props: NavigatorProps) {
    const { section, document, language, selected, query, collapsed, onToggle, onSelect, onChange } = props;
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const t = d.tree;
    const toast = useToast();
    const [renaming, setRenaming] = useState<string | null>(null);
    const [dragged, setDragged] = useState<string | null>(null);
    const [target, setTarget] = useState<{ uid: string; zone: Zone } | null>(null);

    const zoneOf = (event: DragEvent<HTMLElement>, node: NodeData): Zone => {
        const box = event.currentTarget.getBoundingClientRect();
        const part = (event.clientY - box.top) / box.height;
        if (node.type === 'container' && part > 0.3 && part < 0.7) return 'inside';
        return part < 0.5 ? 'before' : 'after';
    };

    const drop = (node: NodeData, parent: NodeData | null, index: number, zone: Zone) => {
        if (!dragged || dragged === node.uid) return;
        const result =
            zone === 'inside'
                ? moveNodeTo(document, section.uid, dragged, node.uid, node.children?.length ?? 0)
                : moveNodeTo(
                      document,
                      section.uid,
                      dragged,
                      parent?.uid ?? null,
                      index + (zone === 'after' ? 1 : 0),
                  );
        if (result.refused) toast.error(t.refused[result.refused] ?? result.refused);
        else onChange(result.document);
    };

    const rows = (list: readonly NodeData[], parent: NodeData | null, depth: number) =>
        list.map((node, index) => {
            if (!nodeMatches(node, query, language, ui)) return null;
            const name = nodeName(node, ui);
            const snippet = nodeSnippet(node, language);
            const open = !!query || !collapsed.has(node.uid);
            const isSelected = selected === node.uid;
            const zone = target?.uid === node.uid ? target.zone : null;
            return (
                <li key={node.uid}>
                    <div
                        draggable={renaming !== node.uid}
                        onDragStart={event => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', node.uid);
                            setDragged(node.uid);
                        }}
                        onDragEnd={() => {
                            setDragged(null);
                            setTarget(null);
                        }}
                        onDragOver={event => {
                            if (!dragged || dragged === node.uid) return;
                            event.preventDefault();
                            const next = zoneOf(event, node);
                            if (target?.uid !== node.uid || target.zone !== next)
                                setTarget({ uid: node.uid, zone: next });
                        }}
                        onDragLeave={() => setTarget(current => (current?.uid === node.uid ? null : current))}
                        onDrop={event => {
                            event.preventDefault();
                            drop(node, parent, index, zoneOf(event, node));
                            setDragged(null);
                            setTarget(null);
                        }}
                        style={{ paddingLeft: depth * 14 }}
                        className={cn(
                            'group/row relative flex items-center rounded transition-colors',
                            isSelected ? 'bg-surface shadow-sm ring-1 ring-line-strong' : 'hover:bg-surface',
                            zone === 'inside' && 'ring-2 ring-accent',
                            dragged === node.uid && 'opacity-40',
                            node.hidden && 'text-ink-faint',
                        )}
                    >
                        {zone && zone !== 'inside' && (
                            <span
                                className={cn(
                                    'pointer-events-none absolute right-0 left-0 h-0.5 bg-accent',
                                    zone === 'before' ? '-top-px' : '-bottom-px',
                                )}
                                aria-hidden
                            />
                        )}
                        {node.children ? (
                            <button
                                type="button"
                                aria-expanded={open}
                                aria-label={`${open ? t.collapse : t.expand}: ${name}`}
                                onClick={() => onToggle(node.uid)}
                                className="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                <ElementIcon
                                    name="chevron"
                                    className={cn(
                                        'size-3.5 transition-transform duration-150',
                                        open && 'rotate-90',
                                    )}
                                />
                            </button>
                        ) : (
                            <span className="size-6 shrink-0" aria-hidden />
                        )}
                        {renaming === node.uid ? (
                            <input
                                autoFocus
                                defaultValue={node.label}
                                placeholder={name}
                                maxLength={60}
                                aria-label={t.rename}
                                className="my-0.5 min-w-0 flex-1 rounded border border-line-strong bg-surface px-1.5 py-1 text-sm outline-none focus:border-accent"
                                onBlur={event => {
                                    const label = event.target.value.trim();
                                    if (label !== node.label) {
                                        onChange(
                                            updateNode(document, section.uid, node.uid, item => ({
                                                ...item,
                                                label,
                                            })),
                                        );
                                    }
                                    setRenaming(null);
                                }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                    if (event.key === 'Escape') setRenaming(null);
                                }}
                            />
                        ) : (
                            <button
                                type="button"
                                aria-current={isSelected ? 'true' : undefined}
                                onClick={() => onSelect(node.uid)}
                                onDoubleClick={() => setRenaming(node.uid)}
                                title={t.renameHint}
                                className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded text-left text-sm focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                <ElementIcon name={node.type} className="size-4 shrink-0 text-ink-muted" />
                                <span
                                    className={cn(
                                        'shrink-0',
                                        isSelected ? 'font-semibold text-ink' : 'font-medium',
                                    )}
                                >
                                    {name}
                                </span>
                                {snippet && <span className="truncate text-ink-muted">{snippet}</span>}
                            </button>
                        )}
                        <span
                            className={cn(
                                'flex shrink-0 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-lg:opacity-100',
                                node.hidden && 'opacity-100',
                            )}
                        >
                            <IconButton
                                className="size-7"
                                aria-label={`${node.hidden ? d.show : d.hide}: ${name}`}
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
                                className="size-7"
                                aria-label={`${d.duplicate}: ${name}`}
                                title={d.duplicate}
                                onClick={() => {
                                    const result = duplicateNode(document, section.uid, node.uid);
                                    if (result.refused)
                                        toast.error(t.refused[result.refused] ?? result.refused);
                                    else onChange(result.document);
                                }}
                            >
                                <ElementIcon name="copy" className="size-4" />
                            </IconButton>
                            <IconButton
                                className="size-7"
                                tone="danger"
                                aria-label={`${d.remove}: ${name}`}
                                title={d.remove}
                                onClick={() => onChange(removeNode(document, section.uid, node.uid))}
                            >
                                <ElementIcon name="trash" className="size-4" />
                            </IconButton>
                        </span>
                    </div>
                    {node.children && open && node.children.length > 0 && (
                        <ul>{rows(node.children, node, depth + 1)}</ul>
                    )}
                </li>
            );
        });

    const nodes = section.children ?? [];
    if (!nodes.length) return null;
    return (
        <ul className="pt-0.5 pr-1 pb-1.5 pl-8" aria-label={t.layers}>
            {rows(nodes, null, 0)}
        </ul>
    );
}

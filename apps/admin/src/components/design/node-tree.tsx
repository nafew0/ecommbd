import {
    COLUMN_TEMPLATES,
    createNode,
    createStructure,
    type Device,
    ELEMENT_CATEGORIES,
    ELEMENTS,
    findNode,
    type LayoutDocument,
    type NodeData,
    nodeSnippet,
    pick,
    type SectionData,
    STRUCTURE_PRESETS,
} from '@ecommbd/sections';
import { useState } from 'react';
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
import { ElementIcon, StructureDiagram } from './element-icon';
import type { Language } from './field-controls';
import { IconButton } from './icon-button';
import { NodeSettings } from './node-settings';

/**
 * A free section's tree (roadmap phase 56): its containers and elements as an indented list.
 * Choosing a node opens its own settings in place of the list (node-settings.tsx), with the way
 * back along the top. "Add" under a container opens the picker right
 * there, so it's always clear where the new element goes.
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
                    <Picker onPick={node => add(parent, node)} />
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

    return (
        <div>
            {nodes.length === 0 ? (
                <p className="mb-3 text-sm text-ink-muted">{t.empty}</p>
            ) : (
                <ul className="-mx-2">{rows(nodes, 0)}</ul>
            )}
            <div className={cn(nodes.length > 0 && '-mx-2 mt-1 border-t border-line pt-1')}>
                {addButton(null, t.add)}
                {picker(null)}
            </div>
        </div>
    );
}

/** What can be added: a layout to start from, or one element. */
function Picker({ onPick }: { onPick(node: NodeData): void }) {
    const { messages: m_, language: ui } = useI18n();
    const t = m_.design.tree;
    const elements = ELEMENTS.filter(definition => !definition.internal && definition.type !== 'container');
    return (
        <div className="mt-1 mb-2 space-y-3 rounded-md border border-line bg-surface p-3">
            <div>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    {t.layouts}
                </p>
                <ul className="grid grid-cols-5 gap-1.5">
                    {STRUCTURE_PRESETS.map(preset => {
                        const parts =
                            preset.mode === 'grid'
                                ? COLUMN_TEMPLATES[preset.columns]
                                : Array.from({ length: preset.cells || 3 }, () => 1);
                        const name = t.structures[preset.key];
                        return (
                            <li key={preset.key}>
                                <button
                                    type="button"
                                    title={name}
                                    aria-label={name}
                                    onClick={() => onPick(createStructure(preset))}
                                    className="flex w-full rounded border border-line p-1.5 text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-accent"
                                >
                                    <StructureDiagram parts={parts} vertical={preset.key === 'flex-column'} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <p className="mt-1.5 text-xs text-ink-muted">{t.stackNote}</p>
            </div>
            {ELEMENT_CATEGORIES.filter(category => category !== 'layout').map(category => (
                <div key={category}>
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        {t.categories[category]}
                    </p>
                    <ul className="grid grid-cols-3 gap-1.5">
                        {elements
                            .filter(definition => definition.category === category)
                            .map(definition => (
                                <li key={definition.type}>
                                    <button
                                        type="button"
                                        title={pick(definition.description, ui)}
                                        onClick={() => onPick(createNode(definition.type))}
                                        className="flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded border border-line px-1 text-center text-xs font-medium text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-accent"
                                    >
                                        <ElementIcon
                                            name={definition.type}
                                            className="size-5 text-ink-muted"
                                        />
                                        {pick(definition.name, ui)}
                                    </button>
                                </li>
                            ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

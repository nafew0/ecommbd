import {
    COLUMN_TEMPLATES,
    createNode,
    createStructure,
    ELEMENT_CATEGORIES,
    type ElementCategory,
    ELEMENTS,
    liveBlock,
    type NodeData,
    pick,
    sectionsFor,
    STRUCTURE_PRESETS,
} from '@ecommbd/sections';
import { type DragEvent, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { m } from '../../lib/motion';
import { ElementIcon, StructureDiagram } from './element-icon';
import { SectionIcon } from './section-icon';

/**
 * What can be added to a free section (roadmap phases 56 and 61): a layout to start from, one of
 * the elements, or a ready-made block (a product grid, the order form) that keeps its live data.
 * With seventy-odd choices it opens on a search box and a row of groups; pointing at a tile says
 * what it is in one line. A tile is clicked to add it here, or dragged onto the page.
 */

interface ElementPickerProps {
    onPick(node: NodeData): void;
    /** An element or layout picked up, to drop on the canvas (null: let go). */
    onDragNew?(make: (() => NodeData) | null): void;
    /** A sales page: its own sections (the order form, price packs) are offered as blocks. */
    landing?: boolean;
}

type Group = 'all' | ElementCategory | 'blocks';

interface Tile {
    key: string;
    group: Exclude<Group, 'all'>;
    name: string;
    description: string;
    /** Words it's found by, in both languages. */
    words: string;
    icon: React.ReactNode;
    make(): NodeData;
}

export function ElementPicker({ onPick, onDragNew, landing }: ElementPickerProps) {
    const { messages: m_, language: ui } = useI18n();
    const t = m_.design.tree;
    const [group, setGroup] = useState<Group>('all');
    const [search, setSearch] = useState('');
    const [hint, setHint] = useState('');

    const tiles = useMemo<Tile[]>(() => {
        const structures: Tile[] = STRUCTURE_PRESETS.map(preset => {
            const parts =
                preset.mode === 'grid'
                    ? COLUMN_TEMPLATES[preset.columns]
                    : Array.from({ length: preset.cells || 3 }, () => 1);
            const name = t.structures[preset.key] ?? preset.key;
            return {
                key: preset.key,
                group: 'layout',
                name,
                description: t.stackNote,
                words: name.toLowerCase(),
                icon: <StructureDiagram parts={parts} vertical={preset.key === 'flex-column'} />,
                make: () => createStructure(preset),
            };
        });
        const elements: Tile[] = ELEMENTS.filter(
            definition => !definition.internal && definition.type !== 'container',
        ).map(definition => ({
            key: definition.type,
            group: definition.category,
            name: pick(definition.name, ui),
            description: pick(definition.description, ui),
            words: `${definition.name.bn} ${definition.name.en} ${definition.description.bn} ${definition.description.en}`.toLowerCase(),
            icon: <ElementIcon name={definition.type} className="size-5 text-ink-muted" />,
            make: () => createNode(definition.type),
        }));
        const blocks: Tile[] = sectionsFor(landing ? 'landing' : 'home')
            .filter(definition => !definition.tree)
            .map(definition => ({
                key: `block-${definition.type}`,
                group: 'blocks',
                name: pick(definition.name, ui),
                description: pick(definition.description, ui),
                words: `${definition.name.bn} ${definition.name.en} ${definition.description.bn} ${definition.description.en}`.toLowerCase(),
                icon: <SectionIcon type={definition.type} className="size-5 text-ink-muted" />,
                make: () => liveBlock(definition.type),
            }));
        return [...structures, ...elements, ...blocks];
    }, [landing, t, ui]);

    const words = search.trim().toLowerCase();
    const shown = tiles.filter(tile =>
        words ? tile.words.includes(words) : group === 'all' || tile.group === group,
    );
    const groups: Group[] = ['all', ...ELEMENT_CATEGORIES, 'blocks'];
    const sections = (['layout', ...ELEMENT_CATEGORIES.filter(item => item !== 'layout'), 'blocks'] as const)
        .map(key => ({ key, tiles: shown.filter(tile => tile.group === key) }))
        .filter(section => section.tiles.length > 0);

    const drag = (make: () => NodeData) => ({
        draggable: !!onDragNew,
        onDragStart: (event: DragEvent<HTMLButtonElement>) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('text/plain', 'new');
            onDragNew?.(make);
        },
        onDragEnd: () => onDragNew?.(null),
    });

    return (
        <div className="mt-1 mb-2 overflow-hidden rounded-md border border-line-strong bg-surface">
            <div className="space-y-2 border-b border-line p-2.5">
                <input
                    type="search"
                    value={search}
                    autoFocus
                    onChange={event => setSearch(event.target.value)}
                    placeholder={t.searchElements}
                    aria-label={t.searchElements}
                    className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                />
                {!words && (
                    <div
                        className="-mx-2.5 flex gap-1 overflow-x-auto px-2.5 pb-0.5"
                        role="radiogroup"
                        aria-label={t.elementGroups}
                    >
                        {groups.map(item => (
                            <button
                                key={item}
                                type="button"
                                role="radio"
                                aria-checked={group === item}
                                onClick={() => setGroup(item)}
                                className={cn(
                                    'h-7 shrink-0 rounded px-2 text-xs font-medium transition-colors',
                                    group === item
                                        ? 'bg-ink text-white'
                                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                                )}
                            >
                                {t.categories[item]}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="max-h-[52vh] space-y-3 overflow-y-auto p-2.5">
                {sections.length === 0 && (
                    <p className="py-6 text-center text-sm text-ink-muted">{t.noElementsFound}</p>
                )}
                {sections.map(section => (
                    <div key={section.key}>
                        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                            {t.categories[section.key]}
                        </p>
                        <ul
                            className={cn(
                                'grid gap-1.5',
                                section.key === 'layout' ? 'grid-cols-5' : 'grid-cols-3',
                            )}
                        >
                            {section.tiles.map((tile, index) => (
                                <m.li
                                    key={tile.key}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.16, delay: Math.min(index, 12) * 0.012 }}
                                >
                                    <button
                                        type="button"
                                        title={section.key === 'layout' ? tile.name : undefined}
                                        aria-label={section.key === 'layout' ? tile.name : undefined}
                                        onClick={() => onPick(tile.make())}
                                        onMouseEnter={() => setHint(`${tile.name}: ${tile.description}`)}
                                        onFocus={() => setHint(`${tile.name}: ${tile.description}`)}
                                        {...drag(tile.make)}
                                        className={cn(
                                            'group flex w-full rounded border border-line text-ink transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-ink focus-visible:outline-2 focus-visible:outline-accent active:translate-y-0',
                                            section.key === 'layout'
                                                ? 'p-1.5'
                                                : 'min-h-[68px] flex-col items-center justify-center gap-1.5 px-1 py-2 text-center text-xs leading-tight font-medium',
                                        )}
                                    >
                                        {tile.icon}
                                        {section.key !== 'layout' && tile.name}
                                    </button>
                                </m.li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
            <p
                className="min-h-9 border-t border-line bg-surface-muted px-3 py-2 text-xs leading-snug text-ink-muted"
                aria-live="polite"
            >
                {hint || t.dragHint}
            </p>
        </div>
    );
}

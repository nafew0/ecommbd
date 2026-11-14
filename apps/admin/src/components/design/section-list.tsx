import { LAYOUT_LIMITS, type LayoutDocument, type SectionData } from '@ecommbd/sections';
import {
    ArrowDown,
    ArrowUp,
    Bookmark,
    CircleAlert,
    Copy,
    Ellipsis,
    Eye,
    EyeOff,
    GripVertical,
    Plus,
    Trash2,
} from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import type { LayoutWarning } from './design-api';
import { duplicateSection, moveSection, removeSection, sectionLabel, setHidden } from './document-ops';
import { SectionIcon } from './section-icon';

/**
 * The page's sections in the sidebar (roadmap phase 15): drag by the handle (mouse or finger) or
 * use the arrow keys on it to reorder; hide without deleting; duplicate, save for reuse or remove
 * from the menu. Sections with a problem show a red or amber mark.
 */

interface SectionListProps {
    document: LayoutDocument;
    selected: string | null;
    warnings: LayoutWarning[];
    language: 'bn' | 'en';
    onSelect(uid: string): void;
    onChange(document: LayoutDocument): void;
    onAdd(): void;
    onSaveForReuse(section: SectionData): void;
    onRemoved(): void;
}

const ERRORS = ['invalidUrl', 'invalidAnchor', 'invalidVideo', 'duplicateAnchor', 'tooManySections'];

interface Drag {
    from: number;
    to: number;
    offset: number;
    startY: number;
    /** Each row's top and height when the drag started. */
    rows: Array<{ top: number; height: number }>;
}

export function SectionList(props: SectionListProps) {
    const { document, selected, warnings, language, onSelect, onChange, onAdd } = props;
    const { messages: m, language: ui } = useI18n();
    const d = m.design;
    const list = useRef<HTMLUListElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const full = document.sections.length >= LAYOUT_LIMITS.sections;
    const digits = (n: number) =>
        ui === 'bn' ? String(n).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(n);

    const startDrag = (event: PointerEvent<HTMLButtonElement>, index: number) => {
        if (event.button !== 0) return;
        const rows = [...(list.current?.children ?? [])].map(row => {
            const box = row.getBoundingClientRect();
            return { top: box.top, height: box.height };
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ from: index, to: index, offset: 0, startY: event.clientY, rows });
    };

    const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
        if (!drag) return;
        const offset = event.clientY - drag.startY;
        const dragged = drag.rows[drag.from]!;
        const center = dragged.top + dragged.height / 2 + offset;
        let to = 0;
        drag.rows.forEach((row, index) => {
            if (index !== drag.from && row.top + row.height / 2 < center) to++;
        });
        setDrag({ ...drag, offset, to });
    };

    const endDrag = () => {
        if (!drag) return;
        if (drag.to !== drag.from) onChange(moveSection(document, drag.from, drag.to));
        setDrag(null);
    };

    const keyMove = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
        if (to === null || to < 0 || to >= document.sections.length) return;
        event.preventDefault();
        onChange(moveSection(document, index, to));
        setAnnouncement(
            `${sectionLabel(document.sections[index]!, ui).name}: ${digits(to + 1)} / ${digits(document.sections.length)}`,
        );
        // Keep focus on the moved section's handle.
        requestAnimationFrame(() =>
            list.current?.querySelectorAll<HTMLButtonElement>('[data-drag-handle]')[to]?.focus(),
        );
    };

    /** Where each row sits while another is dragged. */
    const shift = (index: number) => {
        if (!drag) return 0;
        if (index === drag.from) return drag.offset;
        const height = drag.rows[drag.from]!.height + 4;
        if (drag.from < drag.to && index > drag.from && index <= drag.to) return -height;
        if (drag.from > drag.to && index < drag.from && index >= drag.to) return height;
        return 0;
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h2 className="text-sm font-semibold tracking-wide text-ink">{d.sections}</h2>
                <span className="text-xs text-ink-muted">
                    {d.sectionCount(digits(document.sections.length), digits(LAYOUT_LIMITS.sections))}
                </span>
            </div>
            <ul ref={list} className="flex-1 space-y-1 overflow-y-auto px-2 pb-2" aria-label={d.sections}>
                {document.sections.map((section, index) => {
                    const label = sectionLabel(section, language);
                    const sectionWarnings = warnings.filter(item => item.sectionId === section.uid);
                    const error = sectionWarnings.some(item => ERRORS.includes(item.code));
                    const isSelected = selected === section.uid;
                    const dragging = drag?.from === index;
                    return (
                        <li
                            key={section.uid}
                            style={{ transform: `translateY(${shift(index)}px)` }}
                            className={cn(
                                'group relative flex items-center gap-1 rounded-md border pr-1',
                                !dragging && drag && 'transition-transform duration-150',
                                dragging ? 'z-10 border-accent bg-surface shadow-lg' : 'border-transparent',
                                isSelected && !dragging && 'border-accent bg-accent-soft',
                                !isSelected && !dragging && 'hover:bg-surface-muted',
                            )}
                        >
                            <button
                                type="button"
                                data-drag-handle
                                aria-label={`${d.dragToReorder}: ${label.name}`}
                                title={d.dragToReorder}
                                onPointerDown={event => startDrag(event, index)}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={() => setDrag(null)}
                                onKeyDown={event => keyMove(event, index)}
                                className="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-faint hover:text-ink-muted active:cursor-grabbing"
                            >
                                <GripVertical className="size-4" aria-hidden />
                            </button>
                            <button
                                type="button"
                                onClick={() => onSelect(section.uid)}
                                aria-current={isSelected ? 'true' : undefined}
                                className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
                            >
                                <span
                                    className={cn(
                                        'flex size-8 shrink-0 items-center justify-center rounded-md',
                                        isSelected
                                            ? 'bg-accent text-white'
                                            : 'bg-surface-muted text-ink-muted',
                                        section.hidden && 'opacity-50',
                                    )}
                                >
                                    <SectionIcon type={section.type} className="size-4" />
                                </span>
                                <span className={cn('min-w-0 flex-1', section.hidden && 'text-ink-faint')}>
                                    <span className="block truncate text-sm font-medium">{label.name}</span>
                                    {(label.detail || section.hidden) && (
                                        <span className="block truncate text-xs text-ink-muted">
                                            {section.hidden ? d.hidden : label.detail}
                                        </span>
                                    )}
                                </span>
                                {sectionWarnings.length > 0 && (
                                    <CircleAlert
                                        className={cn('size-4 shrink-0', error ? 'text-danger' : 'text-warn')}
                                        aria-label={sectionWarnings
                                            .map(item => d.issues[item.code] ?? item.code)
                                            .join(' ')}
                                    />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange(setHidden(document, section.uid, !section.hidden))}
                                aria-label={`${section.hidden ? d.show : d.hide}: ${label.name}`}
                                title={section.hidden ? d.show : d.hide}
                                className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink',
                                    !section.hidden &&
                                        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100',
                                )}
                            >
                                {section.hidden ? (
                                    <EyeOff className="size-4" aria-hidden />
                                ) : (
                                    <Eye className="size-4" aria-hidden />
                                )}
                            </button>
                            <RowMenu
                                label={d.sectionActions(label.name)}
                                items={[
                                    {
                                        label: d.moveUp,
                                        icon: ArrowUp,
                                        disabled: index === 0,
                                        run: () => onChange(moveSection(document, index, index - 1)),
                                    },
                                    {
                                        label: d.moveDown,
                                        icon: ArrowDown,
                                        disabled: index === document.sections.length - 1,
                                        run: () => onChange(moveSection(document, index, index + 1)),
                                    },
                                    {
                                        label: d.duplicate,
                                        icon: Copy,
                                        disabled: full,
                                        run: () => {
                                            const result = duplicateSection(document, section.uid);
                                            onChange(result.document);
                                            if (result.copy) onSelect(result.copy.uid);
                                        },
                                    },
                                    {
                                        label: d.saveForReuse,
                                        icon: Bookmark,
                                        run: () => props.onSaveForReuse(section),
                                    },
                                    {
                                        label: d.remove,
                                        icon: Trash2,
                                        danger: true,
                                        run: () => {
                                            onChange(removeSection(document, section.uid));
                                            props.onRemoved();
                                        },
                                    },
                                ]}
                            />
                        </li>
                    );
                })}
            </ul>
            <div className="border-t border-line p-3">
                <button
                    type="button"
                    onClick={onAdd}
                    disabled={full}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-accent/60 text-sm font-medium text-accent transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-line-strong disabled:text-ink-faint"
                >
                    <Plus className="size-4" aria-hidden />
                    {d.addSection}
                </button>
                {full && (
                    <p className="mt-2 text-center text-xs text-ink-muted">
                        {d.tooMany(digits(LAYOUT_LIMITS.sections))}
                    </p>
                )}
            </div>
            <p className="sr-only" aria-live="polite">
                {announcement}
            </p>
        </div>
    );
}

interface MenuItem {
    label: string;
    icon: typeof Copy;
    run(): void;
    disabled?: boolean;
    danger?: boolean;
}

/**
 * A small "⋯" menu. It's placed on the screen itself (fixed), so a scrolling list never cuts it
 * off, and opens upwards near the bottom; it closes on a choice, an outside click or Escape.
 */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
    const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const open = position !== null;
    useEffect(() => {
        if (!open) return;
        const close = (event: Event) => {
            if (event instanceof globalThis.KeyboardEvent && event.key !== 'Escape') return;
            if (event.type === 'pointerdown' && root.current?.contains(event.target as Node)) return;
            setPosition(null);
        };
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', close);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', close);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [open]);
    const toggle = (button: HTMLButtonElement) => {
        if (open) return setPosition(null);
        const box = button.getBoundingClientRect();
        const right = window.innerWidth - box.right;
        const below = window.innerHeight - box.bottom > 260;
        setPosition(
            below ? { top: box.bottom + 4, right } : { bottom: window.innerHeight - box.top + 4, right },
        );
    };
    return (
        <div ref={root}>
            <button
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={event => toggle(event.currentTarget)}
                className="flex size-8 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink"
            >
                <Ellipsis className="size-4" aria-hidden />
            </button>
            {position && (
                <div
                    role="menu"
                    style={position}
                    className="fixed z-50 min-w-48 rounded-md border border-line bg-surface py-1 shadow-lg"
                >
                    {items.map(item => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={() => {
                                setPosition(null);
                                item.run();
                            }}
                            className={cn(
                                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                                item.danger ? 'text-danger' : 'text-ink',
                            )}
                        >
                            <item.icon className="size-4" aria-hidden />
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

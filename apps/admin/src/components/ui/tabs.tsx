import { useRef } from 'react';
import { cn } from '../../lib/cn';
import { useMessages } from '../../lib/i18n';

export interface TabItem {
    key: string;
    label: string;
    count?: number;
}

interface TabsProps {
    items: TabItem[];
    active: string;
    onChange(key: string): void;
    label: string;
    className?: string;
}

/**
 * Tabs for the parts of one page. Arrow keys move between them. Keep the chosen tab in the URL
 * (`?tab=`) in the page, so a link or the back button returns to it.
 */
export function Tabs({ items, active, onChange, label, className }: TabsProps) {
    const messages = useMessages();
    const list = useRef<HTMLDivElement>(null);
    const move = (index: number) => {
        const next = items[(index + items.length) % items.length];
        if (!next) return;
        onChange(next.key);
        list.current?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus();
    };
    return (
        <div
            ref={list}
            role="tablist"
            aria-label={label}
            className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
        >
            {items.map((item, index) => {
                const selected = item.key === active;
                return (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        data-tab={item.key}
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(item.key)}
                        onKeyDown={event => {
                            if (event.key === 'ArrowRight') move(index + 1);
                            if (event.key === 'ArrowLeft') move(index - 1);
                        }}
                        className={cn(
                            '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                            selected
                                ? 'border-ink font-semibold text-ink'
                                : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
                        )}
                    >
                        {item.label}
                        {item.count !== undefined && (
                            <span className="rounded-md bg-surface-muted px-1.5 text-xs text-ink-muted tabular-nums">
                                {messages.common.number(item.count)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

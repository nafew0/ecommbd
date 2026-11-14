import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { bn } from '../messages/bn';
import { en } from '../messages/en';
import { ACTIONS, MENU, type MenuGroup, visibleMenu } from './menu';

interface Result {
    key: string;
    label: string;
    /** Where it is, shown in grey: the group for a screen. */
    context?: string;
    kind: 'action' | 'screen';
    /** Everything it can be found by, in both languages, lower case. */
    words: string;
    run(): void;
}

/** Screens and actions this role may open, each findable in Bangla and English. */
export function searchIndex(
    menu: MenuGroup[],
    can: (permission: string) => boolean,
    language: 'bn' | 'en',
    go: (to: string) => void,
    startTour: () => void,
): Result[] {
    const t = language === 'bn' ? bn : en;
    const both = (pick: (messages: typeof en) => string) => `${pick(en)} ${pick(bn)}`.toLowerCase();
    const actions: Result[] = ACTIONS.filter(action => can(action.permission)).map(action => ({
        key: `action:${action.label}`,
        label: t.finder[action.label],
        kind: 'action',
        words: both(messages => messages.finder[action.label]),
        run: () => go(action.to),
    }));
    actions.push({
        key: 'action:tour',
        label: t.finder.takeTour,
        kind: 'action',
        words: both(messages => `${messages.finder.takeTour} ${messages.tour.label}`),
        run: startTour,
    });
    const screens: Result[] = menu.flatMap(group =>
        (group.link ? [group.link] : (group.children ?? [])).map(link => ({
            key: link.to,
            label: t.nav[link.label],
            context: group.link ? undefined : t.nav[group.label],
            kind: 'screen' as const,
            words: both(messages => `${messages.nav[link.label]} ${messages.nav[group.label]}`),
            run: () => go(link.to),
        })),
    );
    return [...actions, ...screens];
}

/** Every word typed must appear somewhere in the result's words. */
export function matches(result: Pick<Result, 'words'>, query: string): boolean {
    return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every(word => result.words.includes(word));
}

/**
 * Search for screens and actions (Ctrl K / ⌘ K): what makes hiding screens under "More" safe.
 * Orders, products and customers join in phase 63c.
 */
export function CommandSearch({
    open,
    onClose,
    onStartTour,
}: {
    open: boolean;
    onClose(): void;
    onStartTour(): void;
}) {
    const { messages: t, language } = useI18n();
    const { can } = useAuth();
    const navigate = useNavigate();
    const dialog = useRef<HTMLDialogElement>(null);
    const listId = useId();
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) {
            setQuery('');
            setIndex(0);
            element.showModal();
        } else if (!open && element.open) {
            element.close();
        }
    }, [open]);

    const all = useMemo(
        () => searchIndex(visibleMenu(MENU, can), can, language, to => void navigate(to), onStartTour),
        [can, language, navigate, onStartTour],
    );
    const results = useMemo(() => all.filter(result => matches(result, query)), [all, query]);
    const active = results[Math.min(index, results.length - 1)];

    const choose = (result: Result | undefined) => {
        if (!result) return;
        onClose();
        result.run();
    };

    return (
        <dialog
            ref={dialog}
            aria-label={t.finder.open}
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialog.current) onClose();
            }}
            className="mx-auto mt-[10dvh] mb-auto w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40"
        >
            {open && (
                <div className="flex max-h-[70dvh] flex-col">
                    <div className="flex items-center gap-3 border-b border-line px-4">
                        <Search className="size-5 shrink-0 text-ink-muted" aria-hidden />
                        <input
                            autoFocus
                            type="text"
                            role="combobox"
                            aria-expanded
                            aria-controls={listId}
                            aria-activedescendant={active ? `${listId}-${active.key}` : undefined}
                            aria-label={t.finder.placeholder}
                            placeholder={t.finder.placeholder}
                            value={query}
                            onChange={event => {
                                setQuery(event.target.value);
                                setIndex(0);
                            }}
                            onKeyDown={event => {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    setIndex(value => Math.min(value + 1, results.length - 1));
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    setIndex(value => Math.max(value - 1, 0));
                                }
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    choose(active);
                                }
                            }}
                            className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
                        />
                    </div>
                    <ul
                        id={listId}
                        role="listbox"
                        aria-label={t.finder.open}
                        className="min-h-0 flex-1 overflow-y-auto p-2"
                    >
                        {results.map((result, position) => {
                            const heading = result.kind !== results[position - 1]?.kind;
                            const selected = result === active;
                            return (
                                <li key={result.key} role="presentation">
                                    {heading && (
                                        <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-muted">
                                            {result.kind === 'action' ? t.finder.actions : t.finder.screens}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        role="option"
                                        id={`${listId}-${result.key}`}
                                        aria-selected={selected}
                                        tabIndex={-1}
                                        ref={element => {
                                            if (selected) element?.scrollIntoView({ block: 'nearest' });
                                        }}
                                        onMouseMove={() => setIndex(position)}
                                        onClick={() => choose(result)}
                                        className={cn(
                                            'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm',
                                            selected && 'bg-surface-muted',
                                        )}
                                    >
                                        <span className="min-w-0 flex-1">
                                            {result.label}
                                            {result.context && (
                                                <span className="ml-2 text-[13px] text-ink-muted">
                                                    {result.context}
                                                </span>
                                            )}
                                        </span>
                                        {selected && (
                                            <CornerDownLeft
                                                className="size-4 shrink-0 text-ink-faint"
                                                aria-hidden
                                            />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                        {results.length === 0 && (
                            <li className="px-3 py-8 text-center text-sm text-ink-muted">{t.finder.empty}</li>
                        )}
                    </ul>
                    <p className="hidden border-t border-line px-4 py-2 text-xs text-ink-muted sm:block">
                        {query ? t.finder.keys : t.finder.hint}
                    </p>
                </div>
            )}
        </dialog>
    );
}
